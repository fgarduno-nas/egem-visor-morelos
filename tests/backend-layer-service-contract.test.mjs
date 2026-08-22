import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const source = await fs.readFile(path.resolve("backend/src/modules/layers/layers.service.js"), "utf8");
const routesSource = await fs.readFile(path.resolve("backend/src/modules/layers/layers.routes.js"), "utf8");
const controllerSource = await fs.readFile(path.resolve("backend/src/modules/layers/layers.controller.js"), "utf8");
const schemasSource = await fs.readFile(path.resolve("backend/src/modules/layers/layers.schemas.js"), "utf8");

function extractFunctionSource(name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `No se encontro ${name}`);
  const start = match.index;
  const signatureEnd = source.indexOf(")", start);
  const openBrace = source.indexOf("{", signatureEnd);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`No se pudo extraer ${name}`);
}

function buildBackendHelpers() {
  class AppError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  const helperSource = [
    extractFunctionSource("normalizeOptionalText"),
    extractFunctionSource("normalizeHexColor"),
    extractFunctionSource("parseRasterLegend"),
    extractFunctionSource("getHtmlDescriptionAttribute"),
    extractFunctionSource("getVectorLegendPreviewLabel"),
    extractFunctionSource("getVectorLegendPreviewOrder"),
    extractFunctionSource("getDominantVectorLegendConcept"),
    extractFunctionSource("getVectorLegendPreviewField"),
    "return { parseRasterLegend, getVectorLegendPreviewLabel, getVectorLegendPreviewField, AppError };",
  ].join("\n");

  return Function("AppError", helperSource)(AppError);
}

const helpers = buildBackendHelpers();

test("parseRasterLegend conserva titulo, valores, orden y colores exactos", () => {
  const legend = helpers.parseRasterLegend(JSON.stringify({
    field: "Inestabilidad",
    classes: [
      { value: 5, label: "Muy Alta", color: "#ff2200", order: 5 },
      { value: 1, label: "Muy Baja", color: "#006100", order: 1 },
    ],
  }));

  assert.equal(legend.field, "Inestabilidad");
  assert.deepEqual(legend.classes.map((item) => item.value), ["1", "5"]);
  assert.deepEqual(legend.classes.map((item) => item.label), ["Muy Baja", "Muy Alta"]);
  assert.deepEqual(legend.classes.map((item) => item.color), ["#006100", "#ff2200"]);
});

test("parseRasterLegend mantiene compatibilidad con arreglo antiguo", () => {
  const legend = helpers.parseRasterLegend(JSON.stringify([
    { label: "Baja", color: "#7aab00" },
    { label: "Alta", color: "#ff9900" },
  ]));

  assert.equal(legend.field, "Simbología raster");
  assert.deepEqual(legend.classes.map((item) => item.label), ["Baja", "Alta"]);
});

test("parseRasterLegend rechaza colores duplicados", () => {
  assert.throws(
    () => helpers.parseRasterLegend(JSON.stringify({
      field: "Inestabilidad",
      classes: [
        { label: "Baja", color: "#7aab00", order: 1 },
        { label: "Alta", color: "#7aab00", order: 2 },
      ],
    })),
    /colores duplicados/,
  );
});

test("preview vectorial usa Intensid_1 sin convertirlo automaticamente en Peligro", () => {
  const description = "<table><tr><td>Intensid_1</td><td>Muy alto</td></tr><tr><td>R_P_V_E_A</td><td>Susceptibilidad</td></tr></table>";
  const label = helpers.getVectorLegendPreviewLabel({ Name: "17", description });
  const field = helpers.getVectorLegendPreviewField([{ label, color: "#ff2200", order: 5 }], [
    { properties: { description } },
  ]);

  assert.equal(label, "Muy alto");
  assert.equal(field, "Susceptibilidad");
});

test("preview vectorial solo usa Peligro cuando el concepto dominante es Peligro", () => {
  const description = "<table><tr><td>Intensid_1</td><td>Muy alto</td></tr><tr><td>R_P_V_E_A</td><td>Peligro</td></tr></table>";
  const label = helpers.getVectorLegendPreviewLabel({ Name: "17", description });
  const field = helpers.getVectorLegendPreviewField([{ label, color: "#ff2200", order: 5 }], [
    { properties: { description } },
  ]);

  assert.equal(label, "Muy alto");
  assert.equal(field, "Peligro");
});

test("backend expone actualizacion acotada de rasterLegend para capas existentes", () => {
  const updateSource = extractFunctionSource("updateLayerRasterLegend");

  assert.match(routesSource, /"\/:id\/raster-legend"/);
  assert.match(routesSource, /authorizeRoles\(ROLE_CODES\.ADMIN\)/);
  assert.match(controllerSource, /updateLayerRasterLegendController/);
  assert.match(schemasSource, /rasterLegendSchema/);
  assert.match(updateSource, /rasterLegend = parseRasterLegend/);
  assert.match(updateSource, /properties:\s*\{\s*\.\.\.metadataProperties,\s*rasterLegend,/);
  assert.doesNotMatch(updateSource, /groundOverlays:\s*\[/);
  assert.doesNotMatch(updateSource, /files:\s*\{/);
});
