import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const mapSource = await fs.readFile(path.resolve("js/map.js"), "utf8");

function extractFunctionSource(source, functionName) {
  const declaration = `function ${functionName}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `No se encontro ${functionName}`);

  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `No se encontro cuerpo de ${functionName}`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`No se pudo extraer ${functionName}`);
}

const degreesSource = extractFunctionSource(mapSource, "degreesToRadians");
const computeDistanceSource = extractFunctionSource(mapSource, "computeDistanceMeters");
const computePathSource = extractFunctionSource(mapSource, "computePathDistanceMeters");
const formatDistanceSource = extractFunctionSource(mapSource, "formatDistance");
const handleMeasurementSource = extractFunctionSource(mapSource, "handleMeasurementClick");
const toggleMeasureSource = extractFunctionSource(mapSource, "toggleMeasureTool");
const clearMeasurementSource = extractFunctionSource(mapSource, "clearMeasurement");

const computeDistanceMeters = Function(
  `"use strict"; const degreesToRadians = ${degreesSource}; return ${computeDistanceSource};`,
)();
const computePathDistanceMeters = Function(
  `"use strict"; const degreesToRadians = ${degreesSource}; const computeDistanceMeters = ${computeDistanceSource}; return ${computePathSource};`,
)();
const formatDistance = Function(`"use strict"; return ${formatDistanceSource};`)();

function independentHaversine(start, end) {
  const radius = 6371008.8;
  const toRadians = (value) => value * (Math.PI / 180);
  const lat1 = toRadians(start[1]);
  const lat2 = toRadians(end[1]);
  const deltaLat = toRadians(end[1] - start[1]);
  const deltaLng = toRadians(end[0] - start[0]);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radius * c;
}

test("la medicion usa distancia horizontal geodesica entre dos coordenadas", () => {
  const start = [-99.2300, 18.9200];
  const end = [-99.2200, 18.9200];

  assert.equal(computeDistanceMeters(start, start), 0);
  assert.ok(Math.abs(computeDistanceMeters(start, end) - independentHaversine(start, end)) < 0.001);
  assert.doesNotMatch(computeDistanceSource, /terrain|elevation|altitude|desnivel|dem|pendiente/i);
});

test("la medicion acumula tres o mas puntos por tramos sin reiniciar al segundo clic", () => {
  const points = [
    [-99.2300, 18.9200],
    [-99.2200, 18.9200],
    [-99.2200, 18.9300],
  ];
  const expected =
    independentHaversine(points[0], points[1]) +
    independentHaversine(points[1], points[2]);

  assert.equal(computePathDistanceMeters([]), 0);
  assert.equal(computePathDistanceMeters([points[0]]), 0);
  assert.ok(Math.abs(computePathDistanceMeters(points) - expected) < 0.001);
  assert.match(handleMeasurementSource, /state\.measurement\.points\.push/);
  assert.match(handleMeasurementSource, /state\.measurement\.points\.length >= 2/);
  assert.match(handleMeasurementSource, /computePathDistanceMeters\(points\)/);
  assert.match(handleMeasurementSource, /Tramos: \$\{points\.length - 1\}/);
  assert.doesNotMatch(handleMeasurementSource, /state\.measurement\.points = \[\]/);
});

test("la medicion documenta alcance horizontal y mantiene reinicio explicito", () => {
  assert.match(toggleMeasureSource, /dos o mas puntos/);
  assert.match(toggleMeasureSource, /distancia horizontal geodesica acumulada por tramos/);
  assert.match(toggleMeasureSource, /No toma en cuenta pendientes ni desniveles del terreno/);
  assert.match(toggleMeasureSource, /state\.measurement\.points = \[\]/);
  assert.match(clearMeasurementSource, /state\.measurement\.points = \[\]/);
  assert.match(clearMeasurementSource, /state\.activeTool = null/);
});

test("el formato conserva metros y kilometros sin depender de elevacion", () => {
  assert.equal(formatDistance(0), "0.0 m");
  assert.equal(formatDistance(999.94), "999.9 m");
  assert.equal(formatDistance(1500), "1.50 km");
  assert.doesNotMatch(computePathSource, /terrain|elevation|altitude|desnivel|dem|pendiente/i);
});
