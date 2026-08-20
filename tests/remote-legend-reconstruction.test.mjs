import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const modulePath = path.resolve("js/app/utils/remote-legend-utils.js");
const moduleSource = await fs.readFile(modulePath, "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`;
const mapSource = await fs.readFile(path.resolve("js/map.js"), "utf8");

const {
  buildSemanticLegendFromFeatures,
  buildTechnicalStyleFallbackLegend,
  isTechnicalStyleField,
  normalizePublishedVectorLegend,
} = await import(moduleUrl);

function feature(properties) {
  return { type: "Feature", properties, geometry: { type: "Polygon", coordinates: [] } };
}

function extractFunctionSource(source, name) {
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

test("la leyenda vectorial publicada es la fuente semantica y no expone __styleFill", () => {
  const legend = normalizePublishedVectorLegend({
    title: "Inundacion",
    vectorLegend: {
      type: "categorical",
      field: "__styleFill",
      classes: [
        { label: "Alta", color: "#ff9900" },
        { label: "Muy Baja", color: "#006100" },
        { label: "Media", color: "#ffff00" },
        { label: "Baja", color: "#7aab00" },
        { label: "Muy Alta", color: "#ff2200" },
      ],
    },
  });

  assert.equal(legend.field, "Intensidad");
  assert.deepEqual(legend.classes.map((item) => item.label), ["Muy Baja", "Baja", "Media", "Alta", "Muy Alta"]);
  assert.deepEqual(legend.classes.map((item) => item.color), ["#006100", "#7aab00", "#ffff00", "#ff9900", "#ff2200"]);
  assert.equal(legend.classes.some((item) => item.label.startsWith("#")), false);
});

test("la reconstruccion semantica conserva colores tecnicos sin usarlos como etiquetas", () => {
  const legend = buildSemanticLegendFromFeatures([
    feature({ Intensidad: "Muy Baja", __styleFill: "#006100" }),
    feature({ Intensidad: "Baja", __styleFill: "#7aab00" }),
    feature({ Intensidad: "Media", __styleFill: "#ffff00" }),
    feature({ Intensidad: "Alta", __styleFill: "#ff9900" }),
    feature({ Intensidad: "Muy Alta", __styleFill: "#ff2200" }),
  ], "Intensidad");

  assert.equal(legend.field, "Intensidad");
  assert.deepEqual(legend.classes.map((item) => item.label), ["Muy Baja", "Baja", "Media", "Alta", "Muy Alta"]);
  assert.deepEqual(legend.classes.map((item) => item.color), ["#006100", "#7aab00", "#ffff00", "#ff9900", "#ff2200"]);
});

test("la compatibilidad antigua con solo __styleFill usa etiquetas neutras", () => {
  const legend = buildTechnicalStyleFallbackLegend([
    feature({ __styleFill: "#006100" }),
    feature({ __styleFill: "#7aab00" }),
    feature({ __styleFill: "#006100" }),
  ]);

  assert.equal(legend.field, "Leyenda sin etiquetas");
  assert.deepEqual(legend.classes.map((item) => item.label), ["Clase sin etiqueta 1", "Clase sin etiqueta 2"]);
  assert.deepEqual(legend.classes.map((item) => item.color), ["#006100", "#7aab00"]);
  assert.equal(legend.classes.some((item) => item.label.includes("#")), false);
});

test("los campos tecnicos de estilo no son candidatos semanticos", () => {
  ["__styleFill", "__styleStroke", "fillColor", "fill-color", "OGR_STYLE", "styleUrl", "color"].forEach((field) => {
    assert.equal(isTechnicalStyleField(field), true);
  });
  assert.equal(isTechnicalStyleField("Intensidad"), false);
});

test("la ruta diferida conserva vectorLegend como fuente de verdad visible", () => {
  const recordLikeSource = extractFunctionSource(mapSource, "getBackendRecordLikeFromLayer");
  const symbologySource = extractFunctionSource(mapSource, "buildRemoteLayerSymbology");
  const layerSymbologySource = extractFunctionSource(mapSource, "buildLayerSymbology");

  assert.match(recordLikeSource, /vectorLegend:/);
  assert.match(symbologySource, /const publishedLegend = normalizePublishedVectorLegend\(record\)/);
  assert.ok(symbologySource.indexOf("publishedLegend") < symbologySource.indexOf("options.existingStyleIsUsable"));
  assert.match(symbologySource, /buildSemanticLegendFromFeatures\(features, styleField\?\.field\)/);
  assert.match(symbologySource, /buildTechnicalStyleFallbackLegend\(features\)/);
  assert.match(layerSymbologySource, /!isTechnicalStyleField\(layer\.symbology\.field\)/);
});
