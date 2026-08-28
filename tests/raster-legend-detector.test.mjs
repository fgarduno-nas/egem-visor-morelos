import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import {
  ORDINAL_FIVE_LEVEL_PROFILE,
  analyzeRasterLegendImage,
  detectRasterLegendForGroundOverlays,
  inferRasterLegendConcept,
} from "../backend/src/modules/layers/raster-legend-detector.service.js";
import { processKmz } from "../backend/src/modules/layers/layer-processing.service.js";

const palette = [
  [0x00, 0x61, 0x00, 0xff],
  [0x7a, 0xab, 0x00, 0xff],
  [0xff, 0xff, 0x00, 0xff],
  [0xff, 0x99, 0x00, 0xff],
  [0xff, 0x22, 0x00, 0xff],
  [0xff, 0xff, 0xff, 0x00],
];

test("detecta paleta raster ordinal exacta con transparencia y confianza alta", async () => {
  const filePath = writeTempFile("legend-exact.png", buildIndexedPng({
    width: 6,
    height: 2,
    palette,
    pixels: [
      [5, 0, 1, 2, 3, 4],
      [5, 4, 3, 2, 1, 0],
    ],
  }));

  const analysis = await analyzeRasterLegendImage(filePath);

  assert.equal(analysis.width, 6);
  assert.equal(analysis.height, 2);
  assert.equal(analysis.transparentPixelCount, 2);
  assert.equal(analysis.confidence, "high");
  assert.equal(analysis.profile, ORDINAL_FIVE_LEVEL_PROFILE.id);
  assert.deepEqual(analysis.opaqueColors.map((item) => item.color), ORDINAL_FIVE_LEVEL_PROFILE.colors);
  assert.equal(analysis.opaqueColors.some((item) => item.color === "#ffffff"), false);
});

test("detecta PNG RGBA real sin convertirlo en arreglo RGBA persistente", async () => {
  const filePath = writeTempFile("legend-rgba.png", buildRgbaPng({
    width: 6,
    height: 1,
    pixels: [[
      [0x00, 0x61, 0x00, 0xff],
      [0x7a, 0xab, 0x00, 0xff],
      [0xff, 0xff, 0x00, 0xff],
      [0xff, 0x99, 0x00, 0xff],
      [0xff, 0x22, 0x00, 0xff],
      [0xff, 0xff, 0xff, 0x00],
    ]],
  }));

  const analysis = await analyzeRasterLegendImage(filePath);

  assert.equal(analysis.colorType, 6);
  assert.equal(analysis.confidence, "high");
  assert.equal(analysis.transparentPixelCount, 1);
  assert.deepEqual(analysis.opaqueColors.map((item) => item.color), ORDINAL_FIVE_LEVEL_PROFILE.colors);
});

test("genera etiquetas femeninas o masculinas sin usar excepciones por nombre completo", async () => {
  const imagePath = writeTempFile("legend-gender.png", buildIndexedPng({
    width: 5,
    height: 1,
    palette,
    pixels: [[4, 1, 3, 0, 2]],
  }));

  const feminine = await detectRasterLegendForGroundOverlays([{ id: "a", name: "Overlay", sourcePath: "Layer0.png", imagePath }], {
    title: "Susceptibilidad a hundimiento",
  });
  assert.equal(feminine.diagnostics.confidence, "high");
  assert.deepEqual(feminine.rasterLegend.classes.map((item) => item.label), ["Muy baja", "Baja", "Media", "Alta", "Muy alta"]);

  const masculine = await detectRasterLegendForGroundOverlays([{ id: "b", name: "Overlay", sourcePath: "Layer0.png", imagePath }], {
    title: "Peligro por licuacion de suelos",
  });
  assert.equal(masculine.diagnostics.confidence, "high");
  assert.deepEqual(masculine.rasterLegend.classes.map((item) => item.label), ["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"]);

  const unknown = await detectRasterLegendForGroundOverlays([{ id: "c", name: "Overlay", sourcePath: "Layer0.png", imagePath }], {
    title: "Mapa cromatico general",
  });
  assert.equal(unknown.rasterLegend, null);
  assert.equal(unknown.diagnostics.confidence, "low");
  assert.equal(inferRasterLegendConcept({ title: "Vulnerabilidad municipal" }).gender, "feminine");
  assert.equal(inferRasterLegendConcept({ title: "Riesgo urbano" }).gender, "masculine");
});

test("rechaza confianza alta para paleta desconocida, colores insuficientes y PNG no paletizado", async () => {
  const unknownPalette = [
    [0x12, 0x34, 0x56, 0xff],
    [0xff, 0xff, 0xff, 0x00],
  ];
  const unknownPath = writeTempFile("legend-unknown.png", buildIndexedPng({
    width: 2,
    height: 1,
    palette: unknownPalette,
    pixels: [[0, 1]],
  }));
  assert.equal((await analyzeRasterLegendImage(unknownPath)).confidence, "low");

  const incompletePath = writeTempFile("legend-incomplete.png", buildIndexedPng({
    width: 3,
    height: 1,
    palette,
    pixels: [[0, 1, 5]],
  }));
  assert.equal((await analyzeRasterLegendImage(incompletePath)).confidence, "low");

  const rgbPath = writeTempFile("legend-rgb.png", buildRgbPng({
    width: 2,
    height: 2,
    pixels: [
      [[0x12, 0x34, 0x56], [0x65, 0x43, 0x21]],
      [[0x99, 0x88, 0x77], [0xaa, 0xbb, 0xcc]],
    ],
  }));
  const rgb = await analyzeRasterLegendImage(rgbPath);
  assert.equal(rgb.confidence, "low");
  assert.match(rgb.warnings.join(" "), /fuera del perfil conocido/);
});

test("controla imagen corrupta y dimensiones abusivas sin generar leyenda falsa", async () => {
  const corruptPath = writeTempFile("legend-corrupt.png", Buffer.from("not a png"));
  await assert.rejects(() => analyzeRasterLegendImage(corruptPath), /encabezado PNG/);

  const hugePath = writeTempFile("legend-huge.png", buildRgbPngHeader({ width: 20000, height: 2 }));
  await assert.rejects(() => analyzeRasterLegendImage(hugePath), /Dimensiones PNG exceden/);
});

test("rechaza PNG con chunks criticos duplicados o mal ordenados", async () => {
  const duplicateIhdr = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", buildIhdr({ width: 1, height: 1, colorType: 2 })),
    pngChunk("IHDR", buildIhdr({ width: 1, height: 1, colorType: 2 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  await assert.rejects(() => analyzeRasterLegendImage(writeTempFile("duplicate-ihdr.png", duplicateIhdr)), /IHDR duplicado/);

  const latePalette = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", buildIhdr({ width: 1, height: 1, colorType: 3 })),
    pngChunk("IDAT", zlib.deflateSync(Buffer.from([0, 0]))),
    pngChunk("PLTE", Buffer.from([0, 0, 0])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  await assert.rejects(() => analyzeRasterLegendImage(writeTempFile("late-palette.png", latePalette)), /PLTE despues de IDAT/);
});

test("processKmz persiste resultado de deteccion raster para GroundOverlay puro", async () => {
  const layerId = `layer-raster-test-${Date.now()}`;
  const filePath = writeKmz({
    "doc.kml": kmlWithOverlay({ href: "Layer0.png" }),
    "Layer0.png": buildIndexedPng({
      width: 5,
      height: 2,
      palette,
      pixels: [
        [0, 1, 2, 3, 4],
        [5, 5, 5, 5, 5],
      ],
    }),
  });

  const result = await processKmz(
    { id: layerId, title: "Inestabilidad de Laderas", metadata: { properties: {} } },
    { path: filePath, originalname: "FG 01 Inestabilidad de Laderas Talud Infinito.kmz" },
    ["FG 01 Inestabilidad de Laderas Talud Infinito.kmz"],
  );

  try {
    assert.equal(result.resourceType, "ground-overlay");
    assert.equal(result.rasterLegend.type, "raster");
    assert.equal(result.rasterLegend.field, null);
    assert.equal(result.rasterLegend.confidence, "high");
    assert.deepEqual(result.rasterLegend.classes.map((item) => item.color), ORDINAL_FIVE_LEVEL_PROFILE.colors);
    assert.deepEqual(result.rasterLegend.classes.map((item) => item.label), ["Muy baja", "Baja", "Media", "Alta", "Muy alta"]);
    assert.equal(result.rasterLegendDiagnostics.confidence, "high");
    assert.equal(result.rasterLegendDiagnostics.overlays[0].imageName, "Layer0.png");
  } finally {
    fs.rmSync(path.join("uploads", "processed", layerId), { recursive: true, force: true });
  }
});

function writeTempFile(name, bytes) {
  const filePath = path.join(tempDir(), `${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

function tempDir() {
  const dir = path.join(os.tmpdir(), "egem-raster-legend-tests");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildIndexedPng({ width, height, palette: pngPalette, pixels }) {
  const rawRows = [];
  for (let y = 0; y < height; y += 1) {
    rawRows.push(Buffer.from([0, ...pixels[y]]));
  }
  const raw = Buffer.concat(rawRows);
  const plte = Buffer.concat(pngPalette.map(([red, green, blue]) => Buffer.from([red, green, blue])));
  const trns = Buffer.from(pngPalette.map((item) => item[3]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", buildIhdr({ width, height, colorType: 3 })),
    pngChunk("PLTE", plte),
    pngChunk("tRNS", trns),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildRgbPngHeader({ width, height }) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", buildIhdr({ width, height, colorType: 2 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildRgbPng({ width, height, pixels }) {
  const rawRows = [];
  for (let y = 0; y < height; y += 1) {
    rawRows.push(Buffer.from([0, ...pixels[y].flat()]));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", buildIhdr({ width, height, colorType: 2 })),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rawRows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildRgbaPng({ width, height, pixels }) {
  const rawRows = [];
  for (let y = 0; y < height; y += 1) {
    rawRows.push(Buffer.from([0, ...pixels[y].flat()]));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", buildIhdr({ width, height, colorType: 6 })),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rawRows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildIhdr({ width, height, colorType }) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = colorType;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeKmz(entries) {
  const outputPath = writeTempFile("layer.kmz", buildZip(entries));
  return outputPath;
}

function kmlWithOverlay(options = {}) {
  const north = options.north ?? 19.21817655306682;
  const south = options.south ?? 18.24194005423244;
  const east = options.east ?? -98.54297903389683;
  const west = options.west ?? -99.59064917145143;
  return `<kml><Document><GroundOverlay><name>Raster</name><Icon><href>${options.href || "Layer0.png"}</href></Icon><LatLonBox><north>${north}</north><south>${south}</south><east>${east}</east><west>${west}</west><rotation>0</rotation></LatLonBox></GroundOverlay></Document></kml>`;
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
