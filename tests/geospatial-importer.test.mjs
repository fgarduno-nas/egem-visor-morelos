import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
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
  processKmz,
} from "../backend/src/modules/layers/layer-processing.service.js";

const pngBytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const jpgBytes = Buffer.from("ffd8ffe000104a464946", "hex");
const realSe02KmzPath = "D:/EGEM_Mapas/4.- SE Fenómeno Sanitario - Ecológico-20260812T192017Z-1-001/4.- SE Fenómeno Sanitario - Ecológico/SE 02 Sitios de descargas de aguas residuales sin tratamiento.kmz";

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

test("clasifica KMZ vectorial con estilos, metadatos y leyenda sin tratarlo como raster", () => {
  const kml = vectorSanitarioKml();
  const filePath = writeKmz({ "doc.kml": kml });
  const analysis = analyzeKmzFile(filePath);

  assert.equal(analysis.kind, "vector");
  assert.equal(analysis.vector.geometryCount, 36);
  assert.deepEqual(analysis.vector.geometryTypes, ["Polygon"]);
  assert.equal(analysis.groundOverlays.length, 0);
  assert.deepEqual(analysis.diagnostics.internalImages, []);
  assert.equal(analysis.diagnostics.extractedMetadata.scaleOrResolution.value, "1:50,000");
  assert.equal(analysis.diagnostics.extractedMetadata.crs.value, "WGS 84 (EPSG:4326)");
  assert.match(analysis.diagnostics.extractedMetadata.source.value, /INEGI/);
  assert.match(analysis.diagnostics.extractedMetadata.source.value, /CONAGUA-SINA/);
  assert.equal(analysis.diagnostics.vectorLegend.type, "categorical");
  assert.equal(analysis.diagnostics.vectorLegend.field, "Intensidad");
  assert.deepEqual(analysis.diagnostics.vectorLegend.classes.map((item) => item.label), [
    "Muy alto",
    "Alto",
    "Medio",
    "Bajo",
    "Muy bajo",
  ]);
  assert.deepEqual(analysis.diagnostics.vectorLegend.classes.map((item) => item.color), [
    "#ff0000",
    "#ffaa00",
    "#ffff00",
    "#98e600",
    "#38a800",
  ]);
  assert.deepEqual(analysis.diagnostics.vectorLegend.classes.map((item) => item.count), [4, 7, 11, 10, 4]);
});

test("clasifica KMZ puntual con IconStyle, StatusTipo y metadatos seguros", () => {
  const filePath = writeKmz({
    "doc.kml": treatmentPlantsKml(),
    "Layer0_Symbol_4044fea8_0.png": buildRgbaPng(Array.from({ length: 4 }, () => [56, 168, 0, 255]), 2, 2),
    "Layer0_Symbol_404527c8_0.png": buildRgbaPng(Array.from({ length: 4 }, () => [255, 0, 0, 255]), 2, 2),
  });
  const analysis = analyzeKmzFile(filePath);

  assert.equal(analysis.kind, "vector");
  assert.equal(analysis.vector.geometryCount, 57);
  assert.deepEqual(analysis.vector.geometryTypes, ["Point"]);
  assert.equal(analysis.groundOverlays.length, 0);
  assert.deepEqual(analysis.diagnostics.internalImages, [
    "Layer0_Symbol_4044fea8_0.png",
    "Layer0_Symbol_404527c8_0.png",
  ]);
  assert.equal(analysis.diagnostics.extractedMetadata.description.value, null);
  assert.equal(analysis.diagnostics.extractedMetadata.scaleOrResolution.value, "No especificada por la fuente.");
  assert.equal(analysis.diagnostics.extractedMetadata.crs.value, "WGS 84 (EPSG:4326)");
  assert.equal(analysis.diagnostics.extractedMetadata.source.value, null);
  assert.equal(analysis.diagnostics.extractedMetadata.updatedAt.value, null);

  const legend = analysis.diagnostics.vectorLegend;
  assert.equal(legend.type, "categorical");
  assert.equal(legend.field, "StatusTipo");
  assert.equal(legend.styleField, "StatusTipo");
  assert.deepEqual(legend.classes.map((item) => item.label), ["Activa", "Fuera de Operación"]);
  assert.deepEqual(legend.classes.map((item) => item.count), [39, 18]);
  assert.equal(legend.classes[0].color, "#38a800");
  assert.equal(legend.classes[0].iconHref, "Layer0_Symbol_4044fea8_0.png");
  assert.equal(legend.classes[0].styleUrl, "#IconStyle00");
  assert.equal(legend.classes[1].color, "#ff0000");
  assert.equal(legend.classes[1].iconHref, "Layer0_Symbol_404527c8_0.png");
  assert.equal(legend.classes[1].styleUrl, "#IconStyle01");
});

test("detecta carpetas y leyendas independientes en el KMZ real SE 02", () => {
  assert.ok(fs.existsSync(realSe02KmzPath), `No se encontro el KMZ real SE 02 en ${realSe02KmzPath}`);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(realSe02KmzPath)).digest("hex");
  assert.equal(sha256, "c668a62b90b2f24f3cf0305b39f37e387eaa9bb6de9865338f84ef8715d44345");

  const analysis = analyzeKmzFile(realSe02KmzPath);
  assert.equal(analysis.kind, "vector");
  assert.equal(analysis.vector.geometryCount, 1263);
  assert.deepEqual(analysis.vector.geometryTypes, ["Point", "Polygon"]);
  assert.equal(analysis.groundOverlays.length, 0);
  assert.deepEqual(analysis.diagnostics.internalImages, [
    "Layer1_Symbol_4014f648_0.png",
    "Layer5_Symbol_4014fab0_0.png",
  ]);

  const byFolder = new Map(analysis.diagnostics.vectorSublayers.map((item) => [item.folder, item]));
  assert.equal(byFolder.get("Manantial").placemarkCount, 220);
  assert.equal(byFolder.get("Manantial").geometryCounts.Point, 220);
  assert.equal(byFolder.get("Pozo").placemarkCount, 643);
  assert.equal(byFolder.get("Pozo").geometryCounts.Point, 643);
  assert.equal(byFolder.get("Estanque").placemarkCount, 357);
  assert.equal(byFolder.get("Acuifero").placemarkCount, 4);
  assert.equal(byFolder.get("Vedas").placemarkCount, 3);
  assert.equal(byFolder.get("Descargas sin tratamientos").placemarkCount, 36);
  assert.equal(byFolder.get("Manantial").legend, null);
  assert.equal(byFolder.get("Pozo").legend, null);
  assert.equal(byFolder.get("Descargas sin tratamientos").legendField, "Intensidad");
  assert.deepEqual(byFolder.get("Descargas sin tratamientos").legend.classes.map((item) => [item.label, item.count]), [
    ["Muy alto", 2],
    ["Alto", 2],
    ["Medio", 6],
    ["Bajo", 11],
    ["Muy bajo", 15],
  ]);
  assert.equal(analysis.diagnostics.vectorLegend.appliesToFolder, "Descargas sin tratamientos");
  assert.equal(analysis.diagnostics.vectorLegend.appliesToGeometryRole, "descargas-sin-tratamientos");
  assert.equal(JSON.stringify(analysis.diagnostics.vectorSublayers).includes("StatusTipo"), false);
  assert.equal(JSON.stringify(analysis.diagnostics.vectorSublayers).includes("Activa"), false);
  assert.equal(JSON.stringify(analysis.diagnostics.vectorSublayers).includes("Fuera de Operación"), false);
});

test("processKmz preserva Folder, roles, estilos e iconos en el KMZ real SE 02", async () => {
  assert.ok(fs.existsSync(realSe02KmzPath), `No se encontro el KMZ real SE 02 en ${realSe02KmzPath}`);
  const layerId = `se02-real-${Date.now()}`;
  const result = await processKmz(
    { id: layerId, title: "SE 02 Sitios de descargas de aguas residuales sin tratamiento", metadata: { properties: {} } },
    { path: realSe02KmzPath, originalname: path.basename(realSe02KmzPath) },
    [path.basename(realSe02KmzPath)]
  );

  try {
    assert.equal(result.processingStatus, "processed");
    assert.equal(result.resourceType, "vector");
    assert.equal(result.featureCount, 1263);
    assert.equal(result.groundOverlays.length, 0);
    assert.equal(result.rasterLegend, null);
    assert.equal(result.pointIcons.length, 2);
    assert.deepEqual(result.pointIcons.map((item) => item.styleId).sort(), ["IconStyle10", "IconStyle50"]);
    assert.deepEqual(result.pointIcons.map((item) => [item.width, item.height]).sort((a, b) => a[0] - b[0]), [[6, 6], [12, 12]]);

    const geojson = JSON.parse(fs.readFileSync(result.processedGeojsonPath, "utf8"));
    const counts = countProcessedSe02Features(geojson.features);
    assert.equal(counts.total, 1263);
    assert.equal(counts.points, 863);
    assert.equal(counts.polygonParts, 407);
    assert.equal(counts.roles.get("manantial"), 220);
    assert.equal(counts.roles.get("pozo"), 643);
    assert.equal(counts.roles.get("estanque"), 357);
    assert.equal(counts.roles.get("acuifero"), 4);
    assert.equal(counts.roles.get("vedas"), 3);
    assert.equal(counts.roles.get("descargas-sin-tratamientos"), 36);
    assert.equal(counts.legendFields.get("Intensidad"), 36);
    assert.equal(counts.legendFields.size, 1);

    const manantial = geojson.features.find((feature) => feature.properties.__geometryRole === "manantial");
    const pozo = geojson.features.find((feature) => feature.properties.__geometryRole === "pozo");
    const descarga = geojson.features.find((feature) => feature.properties.__geometryRole === "descargas-sin-tratamientos");
    assert.equal(manantial.properties.__kmlFolder, "Manantial");
    assert.equal(manantial.properties.__kmlStyleId, "IconStyle10");
    assert.equal(pozo.properties.__kmlFolder, "Pozo");
    assert.equal(pozo.properties.__kmlStyleId, "IconStyle50");
    assert.equal(descarga.properties.__legendField, "Intensidad");
    assert.equal("StatusTipo" in pozo.properties, false);
    assert.equal(Object.values(pozo.properties).includes("Activa"), false);
    assert.equal(Object.values(pozo.properties).includes("Fuera de Operación"), false);
  } finally {
    fs.rmSync(path.dirname(result.processedGeojsonPath), { recursive: true, force: true });
  }
});

test("enriquece puntos con color de icono dominante y conserva valores cero", () => {
  const kml = treatmentPlantsKml();
  const filePath = writeKmz({
    "doc.kml": kml,
    "Layer0_Symbol_4044fea8_0.png": buildRgbaPng(Array.from({ length: 4 }, () => [56, 168, 0, 255]), 2, 2),
    "Layer0_Symbol_404527c8_0.png": buildRgbaPng(Array.from({ length: 4 }, () => [255, 0, 0, 255]), 2, 2),
  });
  const styleIndex = parseKmlStyleIndex(kml);
  enrichKmlStyleIndexWithKmzIconColors(styleIndex, {
    archivePath: filePath,
    entries: readZipEntries(filePath),
    kmlEntryName: "doc.kml",
  });
  const geojson = {
    type: "FeatureCollection",
    features: Array.from({ length: 57 }, (_item, index) => ({
      type: "Feature",
      properties: {
        Name: `PTAR ${index + 1}`,
        StatusTipo: index < 39 ? "Activa" : "Fuera de Operación",
        Caudal_Tra: index === 39 ? "0" : `${index + 1}`,
      },
      geometry: { type: "Point", coordinates: [-99 + index * 0.001, 18 + index * 0.001] },
    })),
  };

  const enriched = enrichGeoJsonWithKmlStyles(geojson, styleIndex);

  assert.equal(enriched.features[0].properties.__styleIcon, "#38a800");
  assert.equal(enriched.features[39].properties.__styleIcon, "#ff0000");
  assert.equal(enriched.features[39].properties.Caudal_Tra, "0");
});

function writeAndAnalyzeUnsafeKmz(unsafeName) {
  const filePath = writeKmz({
    "doc.kml": kmlWithOverlay({ href: "Layer0.png" }),
    [unsafeName]: pngBytes,
  });
  return analyzeKmzFile(filePath);
}

function vectorSanitarioKml() {
  const classes = [
    ["#PolyStyle00", "Muy Alto", "7d0000ff", 4],
    ["#PolyStyle07", "Alto", "7d00aaff", 7],
    ["#PolyStyle01", "Medio", "7d00ffff", 11],
    ["#PolyStyle04", "Bajo", "7d00e698", 10],
    ["#PolyStyle06", "Muy Bajo", "7d00a838", 4],
  ];
  const styles = classes.map(([id, _label, color]) => {
    return `<Style id="${id.slice(1)}"><PolyStyle><color>${color}</color></PolyStyle></Style>`;
  }).join("");
  const placemarks = classes.flatMap(([styleUrl, label, _color, count]) => {
    return Array.from({ length: count }, (_item, index) => `
      <Placemark>
        <name>${label} ${index + 1}</name>
        <description><![CDATA[<table><tr><td>Intensidad</td><td>${label}</td></tr><tr><td>Fuente</td><td>México en cifras INEGI, 2020</td></tr></table>]]></description>
        <styleUrl>${styleUrl}</styleUrl>
        <MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>-99,18,0 -98,18,0 -98,19,0 -99,19,0 -99,18,0</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry>
      </Placemark>
    `);
  }).join("");
  return `<kml><Document>${styles}<Folder><description><![CDATA[Permite identificar zonas de peligro. Fuentes de Información, elaboración propia con datos de: Instituto Nacional de Estadística y Geografía - INEGI. Escala: 1:50,000 año 2025. Sistema Nacional de Información del Agua - CONAGUA-SINA. Año 2026.]]></description>${placemarks}</Folder></Document></kml>`;
}

function treatmentPlantsKml() {
  const styles = `
    <Style id="IconStyle00">
      <IconStyle><color>00000000</color><scale>1.125000</scale><Icon><href>Layer0_Symbol_4044fea8_0.png</href></Icon></IconStyle>
    </Style>
    <Style id="IconStyle01">
      <IconStyle><color>00000000</color><scale>1.125000</scale><Icon><href>Layer0_Symbol_404527c8_0.png</href></Icon></IconStyle>
    </Style>
  `;
  const placemarks = [
    ...Array.from({ length: 39 }, (_item, index) => treatmentPlantPlacemark(index + 1, "Activa", "#IconStyle00", `${1.5 + index}`)),
    ...Array.from({ length: 18 }, (_item, index) => treatmentPlantPlacemark(index + 40, "Fuera de Operación", "#IconStyle01", index === 0 ? "0" : `${index}`)),
  ].join("");
  return `<kml><Document><name>SE 2.1 Plantas de tratamiento</name>${styles}<Folder><name>Layer0</name>${placemarks}</Folder></Document></kml>`;
}

function treatmentPlantPlacemark(index, status, styleUrl, caudal) {
  const lon = (-99 + index * 0.001).toFixed(6);
  const lat = (18.5 + index * 0.001).toFixed(6);
  return `
    <Placemark>
      <name>PTAR ${index}</name>
      <description><![CDATA[${treatmentPlantDescription({ index, status, caudal, lat, lon })}]]></description>
      <styleUrl>${styleUrl}</styleUrl>
      <Point><coordinates>${lon},${lat},1420</coordinates></Point>
    </Placemark>
  `;
}

function treatmentPlantDescription({ index = 1, status = "Activa", caudal = "0", lat = "18.500000", lon = "-99.000000" } = {}) {
  return `<table>
    <tr><td>FID</td><td>${index}</td></tr>
    <tr><td>MunCve</td><td>017</td></tr>
    <tr><td>MunNom</td><td>Puente de Ixtla</td></tr>
    <tr><td>LocNom</td><td>Xoxocotla Centro</td></tr>
    <tr><td>PtarNombre</td><td>PTAR ${index}</td></tr>
    <tr><td>Caudal_Tra</td><td>${caudal}</td></tr>
    <tr><td>StatusTipo</td><td>${status}</td></tr>
    <tr><td>Lat</td><td>${lat}</td></tr>
    <tr><td>Long</td><td>${lon}</td></tr>
    <tr><td>ALTITUD</td><td>1420</td></tr>
  </table>`;
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

function countProcessedSe02Features(features) {
  return features.reduce((counts, feature) => {
    counts.total += 1;
    if (["Point", "MultiPoint"].includes(feature.geometry?.type)) counts.points += 1;
    counts.polygonParts += countPolygonParts(feature.geometry);
    const role = feature.properties?.__geometryRole || null;
    if (role) counts.roles.set(role, (counts.roles.get(role) || 0) + 1);
    const legendField = feature.properties?.__legendField || null;
    if (legendField) counts.legendFields.set(legendField, (counts.legendFields.get(legendField) || 0) + 1);
    return counts;
  }, {
    total: 0,
    points: 0,
    polygonParts: 0,
    roles: new Map(),
    legendFields: new Map(),
  });
}

function countPolygonParts(geometry) {
  if (!geometry) return 0;
  if (geometry.type === "Polygon") return 1;
  if (geometry.type === "MultiPolygon") return geometry.coordinates?.length || 0;
  if (geometry.type === "GeometryCollection") {
    return (geometry.geometries || []).reduce((total, item) => total + countPolygonParts(item), 0);
  }
  return 0;
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
