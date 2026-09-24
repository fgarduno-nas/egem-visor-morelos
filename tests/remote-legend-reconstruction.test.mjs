import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = path.resolve("js/app/utils/remote-legend-utils.js");
const mapSource = await fs.readFile(path.resolve("js/map.js"), "utf8");

const {
  buildBestSemanticLegendFromFeatures,
  buildRasterLegendFallback,
  buildSemanticLegendFromFeatures,
  buildTechnicalStyleFallbackLegend,
  getFeatureStyleLegendLabel,
  getFeatureVisualPriorityRank,
  isNoAplicaLegendValue,
  isTechnicalStyleField,
  legendTextsAreEquivalent,
  NO_APLICA_COLOR,
  normalizeLegendComparisonText,
  normalizePublishedRasterLegend,
  normalizePublishedVectorLegend,
  pickTopFeatureByVisualPriority,
} = await import(pathToFileURL(modulePath).href);

function feature(properties) {
  return { type: "Feature", properties, geometry: { type: "Polygon", coordinates: [] } };
}

function ringFeature(label, color, halfSize) {
  return {
    type: "Feature",
    properties: { Intensidad: label, __styleFill: color },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [-halfSize, -halfSize],
        [halfSize, -halfSize],
        [halfSize, halfSize],
        [-halfSize, halfSize],
        [-halfSize, -halfSize],
      ]],
    },
  };
}

function pointInSquare(point, ring) {
  const xs = ring.map((coordinate) => coordinate[0]);
  const ys = ring.map((coordinate) => coordinate[1]);
  return point[0] >= Math.min(...xs) &&
    point[0] <= Math.max(...xs) &&
    point[1] >= Math.min(...ys) &&
    point[1] <= Math.max(...ys);
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

test("No Aplica se reconoce solo como categoria exacta normalizada", () => {
  assert.equal(NO_APLICA_COLOR, "#808080");
  assert.equal(isNoAplicaLegendValue("No Aplica"), true);
  assert.equal(isNoAplicaLegendValue("No aplica"), true);
  assert.equal(isNoAplicaLegendValue("NO APLICA"), true);
  assert.equal(isNoAplicaLegendValue("  No Aplica  "), true);
  assert.equal(isNoAplicaLegendValue("No aplicable"), false);
  assert.equal(isNoAplicaLegendValue("N/A"), false);
  assert.equal(isNoAplicaLegendValue(""), false);
  assert.equal(isNoAplicaLegendValue(null), false);
  assert.equal(isNoAplicaLegendValue(undefined), false);
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

test("la leyenda semantica lee Intensidad desde descripcion HTML aunque exista una sola clase", () => {
  const description = `
    <table>
      <tr><td>Intensidad</td><td>Alto</td></tr>
      <tr><td>R_P_V_E_A</td><td>Peligro</td></tr>
    </table>
  `;
  const legend = normalizePublishedVectorLegend({ title: "Accidentes por autotransporte" }, {
    preferredField: "Intensidad",
    features: [
      feature({ Name: "17", description, __styleFill: "#000000" }),
      feature({ Name: "17", description, __styleFill: "#000000" }),
    ],
  });

  assert.equal(legend.field, "Peligro");
  assert.deepEqual(legend.classes.map((item) => item.label), ["Alto"]);
  assert.deepEqual(legend.classes.map((item) => item.color), ["#000000"]);
});

test("ciclon tropical conserva No Aplica desde el HTML y no cae en clase anonima", () => {
  const sourceFeature = feature({
    Name: "17",
    Description: "<table><tr><td>Intensidad</td><td>No Aplica</td></tr></table>",
    __styleFill: "#d7b09e",
  });
  const legend = normalizePublishedVectorLegend({ title: "Ciclón tropical" }, {
    preferredField: "Intensidad",
    features: [sourceFeature],
  });

  assert.equal(legend.field, "Intensidad");
  assert.equal(legend.styleField, "Intensidad");
  assert.deepEqual(legend.classes.map((item) => item.label), ["No Aplica"]);
  assert.deepEqual(legend.classes.map((item) => item.color), [NO_APLICA_COLOR]);
  assert.equal(sourceFeature.properties.__styleFill, "#d7b09e");
});

test("No Aplica usa gris en leyenda publicada sin tocar el color fuente", () => {
  const record = {
    title: "Capa publicada",
    vectorLegend: {
      type: "categorical",
      field: "Intensidad",
      classes: [
        { label: "No Aplica", color: "#d7b09e", outlineColor: "#d7b09e" },
        { label: "Alto", color: "#ff0000" },
      ],
    },
  };
  const legend = normalizePublishedVectorLegend(record);

  assert.deepEqual(legend.classes.map((item) => `${item.label}:${item.color}:${item.outlineColor}`), [
    `No Aplica:${NO_APLICA_COLOR}:${NO_APLICA_COLOR}`,
    `Alto:#ff0000:#ff0000`,
  ]);
  assert.equal(record.vectorLegend.classes[0].color, "#d7b09e");
});

test("No aplica en un campo secundario no cambia una clase Alto", () => {
  const legend = buildSemanticLegendFromFeatures([
    feature({
      Intensidad: "Alto",
      Perlo_Ret: "No aplica",
      __styleFill: "#ff9900",
      __styleLine: "#ff9900",
    }),
  ], "Intensidad");

  assert.equal(legend.field, "Intensidad");
  assert.equal(legend.styleField, "Intensidad");
  assert.deepEqual(legend.classes.map((item) => `${item.label}:${item.color}:${item.outlineColor}`), [
    "Alta:#ff9900:#ff9900",
  ]);
});

test("la prioridad visual usa color KML ordinal antes que una etiqueta inconsistente", () => {
  assert.equal(getFeatureVisualPriorityRank(feature({
    Description: "<table><tr><td>Intensidad</td><td>Muy Alto</td></tr></table>",
    __styleFill: "#38a800",
  })), 1);
  assert.equal(getFeatureVisualPriorityRank(feature({
    Description: "<table><tr><td>Intensidad</td><td>Bajo</td></tr></table>",
    __styleFill: "#e31a1c",
  })), 5);
});

test("la seleccion de anillos concentricos elige la intensidad visible de cada zona", () => {
  const rings = [
    ringFeature("Muy Bajo", "#38a800", 5),
    ringFeature("Bajo", "#8ccc48", 4),
    ringFeature("Medio", "#ffff00", 3),
    ringFeature("Alto", "#ffc300", 2),
    ringFeature("Muy Alto", "#e31a1c", 1),
  ];
  const cases = [
    { point: [0, 0], expected: "Muy Alto" },
    { point: [1.5, 0], expected: "Alto" },
    { point: [2.5, 0], expected: "Medio" },
    { point: [3.5, 0], expected: "Bajo" },
    { point: [4.5, 0], expected: "Muy Bajo" },
  ];

  cases.forEach(({ point, expected }) => {
    const candidates = rings.filter((item) => pointInSquare(point, item.geometry.coordinates[0]));
    const selected = pickTopFeatureByVisualPriority(candidates);
    assert.equal(selected.properties.Intensidad, expected);
  });
});

test("popup puede alinear una etiqueta inconsistente con la clase visible sin perder el valor original", () => {
  const legend = {
    type: "categorical",
    field: "Peligro",
    classes: [
      { label: "Muy Bajo", color: "#38a800", order: 1 },
      { label: "Bajo", color: "#8ccc48", order: 2 },
      { label: "Medio", color: "#ffff00", order: 3 },
      { label: "Alto", color: "#ffc300", order: 4 },
      { label: "Muy Alto", color: "#e31a1c", order: 5 },
    ],
  };

  assert.equal(getFeatureStyleLegendLabel(feature({ Intensidad: "Alto", __styleFill: "#8ccc48" }), legend), "Bajo");
});

test("si la leyenda publicada contradice los colores KML preservados se reconstruye desde features", () => {
  const record = {
    title: "Histórico de incendios forestales",
    vectorLegend: {
      type: "categorical",
      field: "Intensidad",
      classes: [
        { label: "Bajo", color: "#7aab00", order: 2 },
        { label: "Medio", color: "#ffff00", order: 3 },
        { label: "Alto", color: "#ff9900", order: 4 },
      ],
    },
  };
  const features = [
    feature({ Description: "<table><tr><td>Intensidad</td><td>Bajo</td></tr><tr><td>R_P_V_E_A</td><td>Peligro</td></tr></table>", __styleFill: "#38a800" }),
    feature({ Description: "<table><tr><td>Intensidad</td><td>Medio</td></tr><tr><td>R_P_V_E_A</td><td>Peligro</td></tr></table>", __styleFill: "#ffff00" }),
    feature({ Description: "<table><tr><td>Intensidad</td><td>Alto</td></tr><tr><td>R_P_V_E_A</td><td>Peligro</td></tr></table>", __styleFill: "#ff0000" }),
  ];

  const legend = normalizePublishedVectorLegend(record, { features, preferredField: "Intensidad", record });

  assert.deepEqual(legend.classes.map((item) => `${item.label}:${item.color}`), [
    "Bajo:#38a800",
    "Medio:#ffff00",
    "Alto:#ff0000",
  ]);
});

test("Alto puede ser rojo o naranja segun el estilo real de cada capa", () => {
  const historico = normalizePublishedVectorLegend({ title: "Histórico de incendios forestales" }, {
    preferredField: "Intensidad",
    features: [feature({
      Description: "<table><tr><td>Intensidad</td><td>Alto</td></tr><tr><td>R_P_V_E_A</td><td>Peligro</td></tr></table>",
      __styleFill: "#ff0000",
    })],
  });
  const otraCapa = normalizePublishedVectorLegend({ title: "Peligro por incendios forestales" }, {
    preferredField: "Intensidad",
    features: [feature({
      Description: "<table><tr><td>Intensidad</td><td>Alto</td></tr><tr><td>R_P_V_E_A</td><td>Peligro</td></tr></table>",
      __styleFill: "#ff9900",
    })],
  });

  assert.equal(historico.classes[0].color, "#ff0000");
  assert.equal(otraCapa.classes[0].color, "#ff9900");
});

test("una capa monoclase sin etiqueta semantica no se convierte en No Aplica", () => {
  const legend = normalizePublishedVectorLegend({ title: "Capa monoclase" }, {
    preferredField: "Intensidad",
    features: [feature({ Name: "17", __styleFill: "#d7b09e" })],
  });

  assert.equal(legend, null);
  assert.equal(buildTechnicalStyleFallbackLegend([feature({ Name: "17", __styleFill: "#d7b09e" })]).classes[0].label, "Clase sin etiqueta 1");
});

test("la leyenda publicada no duplica etiqueta como valor secundario", () => {
  const legend = normalizePublishedVectorLegend({
    title: "Susceptibilidad por flujos",
    vectorLegend: {
      type: "categorical",
      field: "Susceptibilidad",
      classes: [
        { label: "Muy Baja", value: "Muy Baja", color: "#006100", order: 1 },
        { label: "Baja", value: "Baja", color: "#7aab00", order: 2 },
        { label: "Media", value: "Media", color: "#ffff00", order: 3 },
        { label: "Alta", value: "Alta", color: "#ff9900", order: 4 },
        { label: "Muy Alta", value: "Muy Alta", color: "#ff2200", order: 5 },
      ],
    },
  });

  assert.equal(legend.field, "Susceptibilidad");
  assert.deepEqual(legend.classes.map((item) => item.label), ["Muy Baja", "Baja", "Media", "Alta", "Muy Alta"]);
  assert.deepEqual(legend.classes.map((item) => item.value), [null, null, null, null, null]);
  assert.deepEqual(legend.classes.map((item) => item.description), [null, null, null, null, null]);
  assert.deepEqual(legend.classes.map((item) => item.color), ["#006100", "#7aab00", "#ffff00", "#ff9900", "#ff2200"]);
});

test("la deduplicacion de descripcion usa equivalencia de presentacion sin cambiar etiqueta", () => {
  const legend = normalizePublishedVectorLegend({
    vectorLegend: {
      field: "Susceptibilidad",
      classes: [
        { label: "Muy Baja", description: " muy&nbsp;&nbsp;baja. ", color: "#006100", order: 1 },
        { label: "Baja", description: "<span>BAJA</span>", color: "#7aab00", order: 2 },
        { label: "Media", description: "Me\u00addia", color: "#ffff00", order: 3 },
      ],
    },
  });

  assert.deepEqual(legend.classes.map((item) => item.label), ["Muy Baja", "Baja", "Media"]);
  assert.deepEqual(legend.classes.map((item) => item.description), [null, null, null]);
  assert.equal(normalizeLegendComparisonText("<b>Muy&nbsp;Baja.</b>"), "muy baja");
  assert.equal(legendTextsAreEquivalent("Media", "Me\u00addia;"), true);
});

test("la descripcion util y los valores distintos se conservan", () => {
  const legend = normalizePublishedVectorLegend({
    vectorLegend: {
      field: "Susceptibilidad",
      classes: [
        {
          label: "Alta",
          description: "Susceptibilidad alta por flujos",
          value: "4",
          color: "#ff9900",
        },
      ],
    },
  });

  assert.equal(legend.classes[0].label, "Alta");
  assert.equal(legend.classes[0].description, "Susceptibilidad alta por flujos");
  assert.equal(legend.classes[0].value, "4");
});

test("solo se fusionan clases totalmente duplicadas, no rangos o colores distintos", () => {
  const legend = normalizePublishedVectorLegend({
    vectorLegend: {
      field: "Indice",
      classes: [
        { label: "Alta", value: "Alta", color: "#ff9900", min: 3, max: 4 },
        { label: "Alta", value: "Alta", color: "#ff9900", min: 3, max: 4 },
        { label: "Alta", color: "#ff2200", min: 4, max: 5 },
        { label: "Alta", color: "#ff9900", min: 4, max: 5 },
      ],
    },
  });

  assert.equal(legend.classes.length, 3);
  assert.deepEqual(
    legend.classes.map((item) => `${item.color}:${item.min}-${item.max}`).sort(),
    ["#ff2200:4-5", "#ff9900:3-4", "#ff9900:4-5"],
  );
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

test("rasterLegend autogenerada conserva tipo raster y no fabrica encabezado redundante", () => {
  const legend = normalizePublishedRasterLegend({
    rasterLegend: {
      type: "raster",
      field: null,
      title: null,
      source: "auto-detected",
      confidence: "high",
      profile: "egem-ordinal-five-level",
      classes: [
        { label: "Muy baja", color: "#006100", order: 1 },
        { label: "Baja", color: "#7aab00", order: 2 },
        { label: "Media", color: "#ffff00", order: 3 },
        { label: "Alta", color: "#ff9900", order: 4 },
        { label: "Muy alta", color: "#ff2200", order: 5 },
      ],
    },
  });

  assert.equal(legend.type, "raster");
  assert.equal(legend.field, null);
  assert.deepEqual(legend.classes.map((item) => item.label), ["Muy baja", "Baja", "Media", "Alta", "Muy alta"]);
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
