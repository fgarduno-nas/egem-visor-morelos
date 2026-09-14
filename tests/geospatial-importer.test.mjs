import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import {
  analyzeKmlText,
  analyzeKmzFile,
  extractGroundOverlayImages,
  readZipEntries,
} from "../backend/src/modules/layers/geospatial-importer.service.js";
import {
  enrichKmlStyleIndexWithKmzIconColors,
  enrichGeoJsonWithKmlStyles,
  parseKmlStyleIndex,
} from "../backend/src/modules/layers/layer-processing.service.js";

const pngBytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const jpgBytes = Buffer.from("ffd8ffe000104a464946", "hex");

test("detecta KMZ GroundOverlay válido y extrae imagen georreferenciada", () => {
  const filePath = writeKmz({
    "doc.kml": kmlWithOverlay({ href: "Layer0.png" }),
    "Layer0.png": pngBytes,
  });
  const analysis = analyzeKmzFile(filePath);
  assert.equal(analysis.kind, "ground-overlay");
  assert.equal(analysis.diagnostics.selectedKml, "doc.kml");
  assert.equal(analysis.groundOverlays.length, 1);
  assert.equal(analysis.groundOverlays[0].imageEntry.name, "Layer0.png");
  assert.deepEqual(analysis.groundOverlays[0].coordinates, [
    [-99.59064917145143, 19.21817655306682],
    [-98.54297903389683, 19.21817655306682],
    [-98.54297903389683, 18.24194005423244],
    [-99.59064917145143, 18.24194005423244],
  ]);

  const overlays = extractGroundOverlayImages({
    archivePath: filePath,
    layerId: "layer-test",
    overlays: analysis.groundOverlays,
    outputRoot: tempDir(),
    publicBaseUrl: "http://localhost:4000",
  });
  assert.equal(overlays[0].mimeType, "image/png");
  assert.match(overlays[0].imageUrl, /ground-overlays\/01-/);
});

test("resuelve href de GroundOverlay dentro de subcarpetas", () => {
  const filePath = writeKmz({
    "kml/main.kml": kmlWithOverlay({ href: "images/raster.jpg" }),
    "kml/images/raster.jpg": jpgBytes,
  });
  const analysis = analyzeKmzFile(filePath);
  assert.equal(analysis.kind, "ground-overlay");
  assert.equal(analysis.groundOverlays[0].imageEntry.name, "kml/images/raster.jpg");
});

test("rechaza LatLonBox incompleto o límites inválidos", () => {
  const incomplete = analyzeKmlText(`<kml><GroundOverlay><Icon><href>a.png</href></Icon><LatLonBox><north>1</north></LatLonBox></GroundOverlay></kml>`);
  assert.equal(incomplete.groundOverlays[0].isValid, false);
  assert.match(incomplete.groundOverlays[0].errors.join(" "), /LatLonBox válido/);

  const inverted = analyzeKmlText(kmlWithOverlay({ south: 20, north: 10 }));
  assert.equal(inverted.groundOverlays[0].isValid, false);
});

test("detecta imagen ausente, MIME no permitido y path traversal", () => {
  const missing = analyzeKmzFile(writeKmz({ "doc.kml": kmlWithOverlay({ href: "missing.png" }) }));
  assert.match(missing.diagnostics.errors.join(" "), /No se encontro la imagen interna/);

  const mime = analyzeKmzFile(writeKmz({ "doc.kml": kmlWithOverlay({ href: "Layer0.png" }), "Layer0.png": Buffer.from("not-png") }));
  assert.match(mime.diagnostics.errors.join(" "), /MIME permitido/);

  assert.throws(() => writeAndAnalyzeUnsafeKmz("../evil.png"), /ruta no segura/);
});

test("detecta rotation distinta de cero sin ignorarla", () => {
  const analysis = analyzeKmlText(kmlWithOverlay({ rotation: 12 }));
  assert.equal(analysis.groundOverlays[0].isValid, false);
  assert.match(analysis.groundOverlays[0].errors.join(" "), /rotation=12/);
});

test("detecta multiples overlays y archivos mixtos vector raster", () => {
  const filePath = writeKmz({
    "doc.kml": `<kml><Document>${kmlOverlayBody({ href: "a.png" })}${kmlOverlayBody({ href: "b.png" })}<Placemark><Point><coordinates>-99,18,0</coordinates></Point></Placemark></Document></kml>`,
    "a.png": pngBytes,
    "b.png": pngBytes,
  });
  const analysis = analyzeKmzFile(filePath);
  assert.equal(analysis.kind, "mixed");
  assert.equal(analysis.vector.geometryCount, 1);
  assert.equal(analysis.groundOverlays.length, 2);
});

test("bloquea KMZ con exceso de entradas como protección zip bomb", () => {
  const entries = { "doc.kml": "<kml />" };
  for (let index = 0; index < 260; index += 1) {
    entries[`x${index}.txt`] = "x";
  }
  assert.throws(() => analyzeKmzFile(writeKmz(entries)), /máximo de 250 entradas/);
});

test("preserva estilos KML por indice cuando ogr2ogr pierde styleUrl y los nombres se repiten", () => {
  const kml = `
    <kml><Document>
      <Style id="green"><PolyStyle><color>a5006100</color></PolyStyle><LineStyle><color>fff0f0f0</color></LineStyle></Style>
      <Style id="yellow"><PolyStyle><color>a500ffff</color></PolyStyle><LineStyle><color>fff0f0f0</color></LineStyle></Style>
      <Style id="red"><PolyStyle><color>a50022ff</color></PolyStyle><LineStyle><color>fff0f0f0</color></LineStyle></Style>
      <Placemark><name>17</name><styleUrl>#green</styleUrl><Polygon /></Placemark>
      <Placemark><name>17</name><styleUrl>#yellow</styleUrl><Polygon /></Placemark>
      <Placemark><name>17</name><styleUrl>#red</styleUrl><Polygon /></Placemark>
    </Document></kml>
  `;
  const geojson = {
    type: "FeatureCollection",
    features: [0, 1, 2].map(() => ({
      type: "Feature",
      properties: { Name: "17" },
      geometry: { type: "Polygon", coordinates: [] },
    })),
  };

  const enriched = enrichGeoJsonWithKmlStyles(geojson, parseKmlStyleIndex(kml));

  assert.deepEqual(enriched.features.map((feature) => feature.properties.__styleFill), [
    "#006100",
    "#ffff00",
    "#ff2200",
  ]);
  assert.deepEqual(enriched.features.map((feature) => feature.properties.__styleOpacity), [
    0.647,
    0.647,
    0.647,
  ]);
});

test("resuelve StyleMap KML usando el estado normal", () => {
  const kml = `
    <kml><Document>
      <Style id="normal"><PolyStyle><color>a500ab7a</color></PolyStyle></Style>
      <Style id="highlight"><PolyStyle><color>a50022ff</color></PolyStyle></Style>
      <StyleMap id="mapped">
        <Pair><key>highlight</key><styleUrl>#highlight</styleUrl></Pair>
        <Pair><key>normal</key><styleUrl>#normal</styleUrl></Pair>
      </StyleMap>
      <Placemark><name>A</name><styleUrl>#mapped</styleUrl><Polygon /></Placemark>
    </Document></kml>
  `;
  const geojson = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { Name: "A" },
      geometry: { type: "Polygon", coordinates: [] },
    }],
  };

  const enriched = enrichGeoJsonWithKmlStyles(geojson, parseKmlStyleIndex(kml));
  assert.equal(enriched.features[0].properties.__styleFill, "#7aab00");
});

test("preserva IconStyle KML como __styleIcon para capas puntuales", () => {
  const kml = `
    <kml><Document>
      <Style id="point"><IconStyle><color>ff336699</color><Icon><href>icon.png</href></Icon></IconStyle></Style>
      <Placemark><name>A</name><styleUrl>#point</styleUrl><Point><coordinates>-99,18,0</coordinates></Point></Placemark>
    </Document></kml>
  `;
  const geojson = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { Name: "A" },
      geometry: { type: "Point", coordinates: [-99, 18] },
    }],
  };

  const enriched = enrichGeoJsonWithKmlStyles(geojson, parseKmlStyleIndex(kml));

  assert.equal(enriched.features[0].properties.__styleIcon, "#996633");
  assert.equal(enriched.features[0].properties.__styleOpacity, 1);
});

test("convierte color KML aabbggrr a CSS rrggbb y opacidad", () => {
  const kml = `
    <kml><Document>
      <Style id="point"><IconStyle><color>80336699</color></IconStyle></Style>
      <Placemark><name>A</name><styleUrl>#point</styleUrl><Point><coordinates>-99,18,0</coordinates></Point></Placemark>
    </Document></kml>
  `;
  const geojson = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { Name: "A" },
      geometry: { type: "Point", coordinates: [-99, 18] },
    }],
  };

  const enriched = enrichGeoJsonWithKmlStyles(geojson, parseKmlStyleIndex(kml));

  assert.equal(enriched.features[0].properties.__styleIcon, "#996633");
  assert.equal(enriched.features[0].properties.__styleOpacity, 0.502);
});

test("usa color dominante de icono PNG interno cuando IconStyle no declara color", () => {
  const kml = `
    <kml><Document>
      <Style id="point">
        <IconStyle><Icon><href>icons/point.png</href></Icon></IconStyle>
        <PolyStyle><color>ff000000</color></PolyStyle>
      </Style>
      <Placemark><name>A</name><styleUrl>#point</styleUrl><Point><coordinates>-99,18,0</coordinates></Point></Placemark>
    </Document></kml>
  `;
  const filePath = writeKmz({
    "doc.kml": kml,
    "icons/point.png": buildRgbaPng([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 0, 255],
      [255, 0, 0, 255],
    ], 2, 2),
  });
  const styleIndex = parseKmlStyleIndex(kml);
  enrichKmlStyleIndexWithKmzIconColors(styleIndex, {
    archivePath: filePath,
    entries: readZipEntries(filePath),
    kmlEntryName: "doc.kml",
  });
  const geojson = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { Name: "A" },
      geometry: { type: "Point", coordinates: [-99, 18] },
    }],
  };

  const enriched = enrichGeoJsonWithKmlStyles(geojson, styleIndex);

  assert.equal(enriched.features[0].properties.__styleIcon, "#ff0000");
  assert.equal(enriched.features[0].properties.__styleFill, undefined);
});

test("KML y KMZ fuerzan una capa GeoJSON unica al invocar ogr2ogr", () => {
  const source = fs.readFileSync(path.resolve("backend/src/modules/layers/layer-processing.service.js"), "utf8");

  assert.match(source, /singleLayerName:\s*"layer"/);
  assert.match(source, /args\.push\("-nln", singleLayerName\)/);
  assert.doesNotMatch(source, /Gasoliner/);
});

function writeAndAnalyzeUnsafeKmz(unsafeName) {
  const filePath = writeKmz({
    "doc.kml": kmlWithOverlay({ href: "Layer0.png" }),
    [unsafeName]: pngBytes,
  });
  return analyzeKmzFile(filePath);
}

function kmlWithOverlay(options = {}) {
  return `<kml><Document>${kmlOverlayBody(options)}</Document></kml>`;
}

function kmlOverlayBody(options = {}) {
  const north = options.north ?? 19.21817655306682;
  const south = options.south ?? 18.24194005423244;
  const east = options.east ?? -98.54297903389683;
  const west = options.west ?? -99.59064917145143;
  const rotation = options.rotation ?? 0;
  return `<GroundOverlay><name>${options.name || "Raster"}</name><Icon><href>${options.href || "Layer0.png"}</href></Icon><LatLonBox><north>${north}</north><south>${south}</south><east>${east}</east><west>${west}</west><rotation>${rotation}</rotation></LatLonBox></GroundOverlay>`;
}

function writeKmz(entries) {
  const outputPath = path.join(tempDir(), `${Date.now()}-${Math.random().toString(16).slice(2)}.kmz`);
  fs.writeFileSync(outputPath, buildZip(entries));
  return outputPath;
}

function tempDir() {
  const dir = path.join(os.tmpdir(), "egem-geospatial-tests");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  Object.entries(entries).forEach(([name, value]) => {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  });

  const centralStart = offset;
  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuffer, end]);
}

function buildRgbaPng(pixels, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = pixels[y * width + x];
      const offset = rowOffset + 1 + x * 4;
      raw[offset] = pixel[0];
      raw[offset + 1] = pixel[1];
      raw[offset + 2] = pixel[2];
      raw[offset + 3] = pixel[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, typeBytes, data, Buffer.alloc(4)]);
}
