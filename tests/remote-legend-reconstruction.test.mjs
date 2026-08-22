import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const modulePath = path.resolve("js/app/utils/remote-legend-utils.js");
const moduleSource = await fs.readFile(modulePath, "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`;
const mapSource = await fs.readFile(path.resolve("js/map.js"), "utf8");

const {
  buildBestSemanticLegendFromFeatures,
  buildRasterLegendFallback,
  buildSemanticLegendFromFeatures,
  buildTechnicalStyleFallbackLegend,
  isTechnicalStyleField,
  normalizePublishedRasterLegend,
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

test("una leyenda publicada con etiquetas 17 se reconstruye como Peligro desde Intensid_1", () => {
  const record = {
    title: "Peligro por deslizamiento lluvia",
    vectorLegend: {
      type: "categorical",
      field: "Estilo",
      classes: [
        { label: "17", color: "#006100" },
        { label: "17", color: "#7aab00" },
        { label: "17", color: "#ffff00" },
        { label: "17", color: "#ff9900" },
        { label: "17", color: "#ff2200" },
      ],
    },
  };
  const features = [
    feature({ Name: "17", gridcode: 1, Intensid_1: "Muy bajo", R_P_V_E_A: "Peligro", __styleFill: "#006100" }),
    feature({ Name: "17", gridcode: 2, Intensid_1: "Bajo", R_P_V_E_A: "Peligro", __styleFill: "#7aab00" }),
    feature({ Name: "17", gridcode: 3, Intensid_1: "Medio", R_P_V_E_A: "Peligro", __styleFill: "#ffff00" }),
    feature({ Name: "17", gridcode: 4, Intensid_1: "Alto", R_P_V_E_A: "Peligro", __styleFill: "#ff9900" }),
    feature({ Name: "17", gridcode: 5, Intensid_1: "Muy alto", R_P_V_E_A: "Peligro", __styleFill: "#ff2200" }),
  ];

  assert.equal(normalizePublishedVectorLegend(record), null);
  const legend = normalizePublishedVectorLegend(record, { features, preferredField: "Intensidad", record });

  assert.equal(legend.field, "Peligro");
  assert.deepEqual(legend.classes.map((item) => item.label), ["Muy Bajo", "Bajo", "Medio", "Alto", "Muy Alto"]);
  assert.deepEqual(legend.classes.map((item) => item.color), ["#006100", "#7aab00", "#ffff00", "#ff9900", "#ff2200"]);
});

test("una capa vectorial con styleId 17 usa etiquetas semanticas cuando existen", () => {
  const record = {
    title: "Peligro por flujos lluvia",
    vectorLegend: {
      type: "categorical",
      field: "styleId",
      classes: [
        { label: "17", color: "#006100" },
        { label: "17", color: "#ff2200" },
      ],
    },
  };
  const legend = normalizePublishedVectorLegend(record, {
    preferredField: "Intensidad",
    record,
    features: [
      feature({ styleId: "17", Intensid_1: "Muy bajo", R_P_V_E_A: "Peligro", __styleFill: "#006100" }),
      feature({ styleId: "17", Intensid_1: "Muy alto", R_P_V_E_A: "Peligro", __styleFill: "#ff2200" }),
    ],
  });

  assert.equal(legend.field, "Peligro");
  assert.deepEqual(legend.classes.map((item) => item.label), ["Muy Bajo", "Muy Alto"]);
});

test("una leyenda numerica publicada con valores distintos no se descarta", () => {
  const legend = normalizePublishedVectorLegend({
    vectorLegend: {
      type: "categorical",
      field: "Periodo",
      classes: [
        { label: "10", color: "#006100" },
        { label: "25", color: "#7aab00" },
        { label: "50", color: "#ffff00" },
      ],
    },
  });

  assert.equal(legend.field, "Periodo");
  assert.deepEqual(legend.classes.map((item) => item.label), ["10", "25", "50"]);
});

test("la mejor reconstruccion semantica usa el concepto dominante como titulo de campo", () => {
  const legend = buildBestSemanticLegendFromFeatures([
    feature({ gridcode: 1, Intensid_1: "Muy Bajo", Indicador: "Peligro", __styleFill: "#006100" }),
    feature({ gridcode: 5, Intensid_1: "Muy Alto", Indicador: "Peligro", __styleFill: "#ff2200" }),
  ], { preferredField: "Intensidad" });

  assert.equal(legend.field, "Peligro");
  assert.deepEqual(legend.classes.map((item) => item.label), ["Muy Bajo", "Muy Alto"]);
});

test("la leyenda raster explicita se respeta y sin metadata usa fallback neutral", () => {
  const rasterLegend = normalizePublishedRasterLegend({
    rasterLegend: {
      field: "Peligro raster",
      classes: [
        { label: "Bajo", color: "#7aab00", order: 2 },
        { label: "Alto", color: "#ff9900", order: 4 },
      ],
    },
  });
  const fallback = buildRasterLegendFallback();

  assert.equal(rasterLegend.field, "Peligro raster");
  assert.deepEqual(rasterLegend.classes.map((item) => item.label), ["Bajo", "Alto"]);
  assert.equal(fallback.field, "Leyenda raster sin etiquetas");
  assert.equal(fallback.classes[0].label, "Imagen raster sin etiquetas publicadas");
  assert.equal(fallback.classes[0].needsMetadata, true);
});

test("raster categorico conserva valores y orden ordinal femenino", () => {
  const legend = normalizePublishedRasterLegend({
    rasterLegend: {
      field: "Inestabilidad",
      classes: [
        { value: 5, label: "Muy Alta", color: "#ff2200", order: 5 },
        { value: 1, label: "Muy Baja", color: "#006100", order: 1 },
        { value: 3, label: "Media", color: "#ffff00", order: 3 },
      ],
    },
  });

  assert.equal(legend.field, "Inestabilidad");
  assert.deepEqual(legend.classes.map((item) => item.value), [1, 3, 5]);
  assert.deepEqual(legend.classes.map((item) => item.label), ["Muy Baja", "Media", "Muy Alta"]);
  assert.deepEqual(legend.classes.map((item) => item.color), ["#006100", "#ffff00", "#ff2200"]);
});

test("raster paletizado publicado como items se normaliza sin cambiar colores", () => {
  const legend = normalizePublishedRasterLegend({
    metadata: {
      properties: {
        rasterLegend: {
          title: "Paleta raster",
          items: [
            { value: "A", label: "Clase A", color: "#123456", order: 2 },
            { value: "B", label: "Clase B", color: "#abcdef", order: 1 },
          ],
        },
      },
    },
  });

  assert.equal(legend.field, "Paleta raster");
  assert.deepEqual(legend.classes.map((item) => item.label), ["Clase B", "Clase A"]);
  assert.deepEqual(legend.classes.map((item) => item.color), ["#abcdef", "#123456"]);
});

test("raster RGB sin rasterLegend no inventa etiquetas", () => {
  const fallback = buildRasterLegendFallback();
  const legend = normalizePublishedRasterLegend({
    resourceType: "ground-overlay",
    rasterLegend: null,
    metadata: { properties: { rasterLegend: null } },
  });

  assert.equal(legend, null);
  assert.equal(fallback.classes[0].needsMetadata, true);
  assert.doesNotMatch(fallback.classes[0].label, /Muy Baja|Muy Alta/);
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
  assert.match(symbologySource, /const publishedLegend = normalizePublishedVectorLegend\(record,\s*\{/);
  assert.ok(symbologySource.indexOf("publishedLegend") < symbologySource.indexOf("options.existingStyleIsUsable"));
  assert.match(symbologySource, /buildBestSemanticLegendFromFeatures\(features, \{ preferredField: styleField\?\.field, record \}\)/);
  assert.match(symbologySource, /buildTechnicalStyleFallbackLegend\(features\)/);
  assert.match(layerSymbologySource, /!isTechnicalStyleField\(layer\.symbology\.field\)/);
  assert.match(mapSource, /rasterLegend:\s*normalizePublishedRasterLegend\(record\)/);
  assert.match(mapSource, /legend:\s*normalizePublishedRasterLegend\(record\) \|\| buildRasterLegendFallback\(\)/);
});
