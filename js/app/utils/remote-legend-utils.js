const ORDINAL_LABEL_ORDER = new Map([
  ["muy baja", 1],
  ["muy bajo", 1],
  ["baja", 2],
  ["bajo", 2],
  ["media", 3],
  ["medio", 3],
  ["alta", 4],
  ["alto", 4],
  ["muy alta", 5],
  ["muy alto", 5],
]);

const TECHNICAL_STYLE_FIELDS = new Set([
  "__stylefill",
  "__styleline",
  "__stylestroke",
  "__styleicon",
  "__stylewidth",
  "__styleopacity",
  "fill",
  "fillcolor",
  "fill color",
  "fill-color",
  "stroke",
  "strokecolor",
  "stroke color",
  "stroke-color",
  "linecolor",
  "line color",
  "line-color",
  "color",
  "style",
  "styleid",
  "style id",
  "styleurl",
  "ogr_style",
  "ogr style",
]);

const GENERIC_LEGEND_FIELDS = new Set([
  "estilo",
  "leyenda",
  "simbolo",
  "simbolo de la capa",
  "symbol",
  "style",
  "name",
  "nombre",
]);

const SEMANTIC_LABEL_FIELDS = [
  "Intensidad",
  "Intensid_1",
  "Intensidad_1",
  "Peligro",
  "Riesgo",
  "Susceptibilidad",
  "Nivel",
  "Clase",
  "Categoria",
  "Categoría",
  "Clasificacion",
  "Clasificación",
  "Fen_Clasif",
];

const CONCEPT_FIELDS = ["R_P_V_E_A", "Indicador", "Fenomeno", "Fenómeno"];

export function isTechnicalStyleField(field) {
  const normalized = normalizeLegendKey(field).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const compact = normalized.replace(/\s+/g, "");
  return TECHNICAL_STYLE_FIELDS.has(normalized) || TECHNICAL_STYLE_FIELDS.has(compact) || String(field || "").startsWith("__");
}

export function normalizePublishedVectorLegend(record = null, options = {}) {
  const candidate = getLegendCandidates(record).find((legend) => Array.isArray(getLegendClasses(legend)));
  if (!candidate) return null;

  const classes = getLegendClasses(candidate)
    .map((item, index) => normalizeLegendClass(item, index))
    .filter((item) => item.label && item.color)
    .sort(compareLegendClasses)
    .slice(0, 24);

  if (!classes.length) return null;

  const rawField =
    candidate.field ||
    candidate.styleField ||
    candidate.attribute ||
    candidate.title ||
    candidate.name ||
    inferLegendFieldFromClasses(classes);
  const field = rawField && !isTechnicalStyleField(rawField) ? String(rawField).trim() : inferLegendFieldFromClasses(classes);
  const legend = {
    type: candidate.type === "continuous" ? "continuous" : "categorical",
    field,
    classes,
  };

  if (!isSemanticallyInvalidLegend(legend, options)) return legend;

  return buildBestSemanticLegendFromFeatures(options.features || [], {
    preferredField: options.preferredField,
    record,
  });
}

export function normalizePublishedRasterLegend(record = null) {
  const candidate = getRasterLegendCandidates(record).find((legend) => Array.isArray(getLegendClasses(legend)));
  if (!candidate) return null;

  const classes = getLegendClasses(candidate)
    .map((item, index) => normalizeLegendClass(item, index))
    .filter((item) => item.label && item.color)
    .sort(compareLegendClasses)
    .slice(0, 24);

  if (!classes.length) return null;

  return {
    type: "raster",
    field: candidate.field || candidate.title || candidate.name || "Simbología raster",
    classes,
  };
}

export function buildRasterLegendFallback() {
  return {
    type: "raster",
    field: "Leyenda raster sin etiquetas",
    classes: [{
      label: "Imagen raster sin etiquetas publicadas",
      color: "transparent",
      outlineColor: "rgba(70, 36, 49, 0.35)",
      needsMetadata: true,
    }],
  };
}

export function isSemanticallyInvalidLegend(legend = null, options = {}) {
  const classes = Array.isArray(legend?.classes) ? legend.classes : [];
  if (classes.length <= 1) return false;

  const labels = classes.map((item) => normalizeLegendLabel(item.label)).filter(Boolean);
  const uniqueLabels = new Set(labels.map((label) => normalizeLegendKey(label)));
  const uniqueColors = new Set(classes.map((item) => normalizeHexColor(item.color)).filter(Boolean));
  if (uniqueColors.size <= 1) return false;

  const repeatedSingleLabel = uniqueLabels.size === 1;
  const fieldIsGeneric = isTechnicalStyleField(legend.field) || GENERIC_LEGEND_FIELDS.has(normalizeLegendKey(legend.field));
  const hasTechnicalLabel = labels.some(looksLikeTechnicalLegendLabel);
  const hasStyleTokenLabel = labels.some(looksLikeStyleTokenLegendLabel);
  const hasSemanticEvidence = buildBestSemanticLegendFromFeatures(options.features || [], {
    preferredField: options.preferredField,
    record: options.record,
    validateOnly: true,
  });

  return (
    hasStyleTokenLabel ||
    (repeatedSingleLabel && (fieldIsGeneric || hasTechnicalLabel || Boolean(hasSemanticEvidence)))
  );
}

export function buildBestSemanticLegendFromFeatures(features, options = {}) {
  if (!Array.isArray(features) || !features.length) return null;
  const fields = [
    options.preferredField,
    ...SEMANTIC_LABEL_FIELDS,
  ].filter(Boolean);
  const seen = new Set();

  for (const field of fields) {
    const key = normalizeLegendKey(field);
    if (seen.has(key) || isTechnicalStyleField(field)) continue;
    seen.add(key);
    const fieldTitle = getSemanticLegendTitle(features, field, options.record);
    const legend = buildSemanticLegendFromFeatures(features, field, { fieldTitle });
    if (legend?.classes?.length > 1) return options.validateOnly ? true : legend;
  }

  return null;
}

export function buildSemanticLegendFromFeatures(features, styleField, options = {}) {
  if (!styleField || isTechnicalStyleField(styleField)) return null;
  const classes = new Map();
  const fieldTitle = options.fieldTitle || styleField;
  const labelAliases = getSemanticFieldAliases(styleField);

  features.forEach((feature) => {
    const properties = feature?.properties || {};
    const rawLabel = getPropertyValueByAlias(properties, labelAliases);
    const label = normalizeOrdinalLegendLabel(rawLabel, fieldTitle);
    const color = normalizeHexColor(properties.__styleFill || properties.__styleLine || properties.__styleIcon);
    if (!label || !color || classes.has(label)) return;
    classes.set(label, {
      label,
      color,
      outlineColor: normalizeHexColor(properties.__styleLine || properties.__styleStroke) || color,
      order: getLegendClassOrder(properties, label),
    });
  });

  const ordered = [...classes.values()].sort(compareLegendClasses).slice(0, 24);
  return ordered.length > 1
    ? {
        type: "categorical",
        field: fieldTitle,
        classes: ordered,
      }
    : null;
}

export function buildTechnicalStyleFallbackLegend(features) {
  const colors = [];
  const seen = new Set();

  features.forEach((feature) => {
    const properties = feature?.properties || {};
    const color = normalizeHexColor(properties.__styleFill || properties.__styleLine || properties.__styleIcon);
    if (!color || seen.has(color)) return;
    seen.add(color);
    colors.push(color);
  });

  return colors.length
    ? {
        type: "categorical",
        field: "Leyenda sin etiquetas",
        classes: colors.slice(0, 24).map((color, index) => ({
          label: `Clase sin etiqueta ${index + 1}`,
          color,
          outlineColor: color,
          technicalValue: color,
        })),
      }
    : null;
}

function getLegendCandidates(record = null) {
  if (!record) return [];
  return [
    record.vectorLegend,
    record.legend,
    record.symbology?.legend,
    record.metadata?.vectorLegend,
    record.metadata?.legend,
    record.metadata?.symbology?.legend,
    record.metadata?.properties?.vectorLegend,
    record.metadata?.properties?.legend,
    record.metadata?.properties?.symbology?.legend,
  ].filter(Boolean);
}

function getRasterLegendCandidates(record = null) {
  if (!record) return [];
  return [
    record.rasterLegend,
    record.legend?.type === "raster" ? record.legend : null,
    record.symbology?.rasterLegend,
    record.metadata?.rasterLegend,
    record.metadata?.legend?.type === "raster" ? record.metadata.legend : null,
    record.metadata?.symbology?.rasterLegend,
    record.metadata?.properties?.rasterLegend,
    record.metadata?.properties?.legend?.type === "raster" ? record.metadata.properties.legend : null,
  ].filter(Boolean);
}

function getLegendClasses(legend) {
  return legend?.classes || legend?.items || legend?.legendItems;
}

function normalizeLegendClass(item, index) {
  const label = normalizeLegendLabel(item?.label ?? item?.name ?? item?.value ?? item?.title);
  const color = normalizeHexColor(item?.color || item?.fillColor || item?.fill || item?.strokeColor || item?.outlineColor);
  const outlineColor = normalizeHexColor(item?.outlineColor || item?.strokeColor || item?.stroke) || color;
  const explicitOrder = Number(item?.order);
  return {
    label,
    color,
    outlineColor,
    order: Number.isFinite(explicitOrder) ? explicitOrder : getOrdinalLegendOrder(label, index),
    value: item?.value ?? label,
    min: item?.min,
    max: item?.max,
  };
}

function compareLegendClasses(a, b) {
  return a.order - b.order || String(a.label).localeCompare(String(b.label), "es");
}

function inferLegendFieldFromClasses(classes) {
  return classes.some((item) => getOrdinalLegendOrder(item.label) < 100)
    ? "Intensidad"
    : "Leyenda";
}

function getSemanticLegendTitle(features, labelField, record = null) {
  const concept = getDominantConceptValue(features);
  if (concept) return toTitleCase(concept);
  const title = normalizeLegendKey(record?.title);
  if (title.includes("peligro")) return "Peligro";
  if (title.includes("riesgo")) return "Riesgo";
  if (title.includes("susceptibilidad")) return "Susceptibilidad";
  return normalizeLegendKey(labelField).replace(/\s+/g, " ") === "intensid 1" ? "Intensidad" : labelField;
}

function getDominantConceptValue(features) {
  const counts = new Map();
  features.forEach((feature) => {
    const value = normalizeLegendLabel(getPropertyValueByAlias(feature?.properties || {}, CONCEPT_FIELDS));
    if (!value) return;
    const normalized = normalizeLegendKey(value);
    if (!["peligro", "riesgo", "susceptibilidad", "intensidad"].includes(normalized)) return;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function getSemanticFieldAliases(field) {
  const normalized = normalizeLegendKey(field).replace(/\s+/g, " ");
  if (normalized === "intensidad" || normalized === "intensid 1") {
    return ["Intensidad", "Intensid_1", "Intensidad_1", "Intensid1"];
  }
  return [field];
}

function getLegendClassOrder(properties, label) {
  const rawGridCode = getPropertyValueByAlias(properties, ["gridcode", "GridCode", "grid_code"]);
  const gridCode = Number(rawGridCode);
  if (rawGridCode !== null && rawGridCode !== undefined && String(rawGridCode).trim() !== "" && Number.isFinite(gridCode)) return gridCode;
  return getOrdinalLegendOrder(label);
}

function getOrdinalLegendOrder(label, fallback = 100) {
  return ORDINAL_LABEL_ORDER.get(normalizeLegendKey(label).replace(/\s+/g, " ").trim()) ?? fallback;
}

function normalizeOrdinalLegendLabel(value, fieldTitle = "") {
  const label = normalizeLegendLabel(value);
  const normalized = normalizeLegendKey(label).replace(/\s+/g, " ").trim();
  const feminine = isFeminineLegendField(fieldTitle);
  const ordinalLabels = {
    "muy baja": feminine ? "Muy Baja" : "Muy Bajo",
    "muy bajo": feminine ? "Muy Baja" : "Muy Bajo",
    baja: feminine ? "Baja" : "Bajo",
    bajo: feminine ? "Baja" : "Bajo",
    media: feminine ? "Media" : "Medio",
    medio: feminine ? "Media" : "Medio",
    alta: feminine ? "Alta" : "Alto",
    alto: feminine ? "Alta" : "Alto",
    "muy alta": feminine ? "Muy Alta" : "Muy Alto",
    "muy alto": feminine ? "Muy Alta" : "Muy Alto",
  };
  return ordinalLabels[normalized] || label;
}

function isFeminineLegendField(fieldTitle) {
  const normalized = normalizeLegendKey(fieldTitle);
  return ["intensidad", "susceptibilidad", "inestabilidad", "amenaza", "vulnerabilidad"].includes(normalized);
}

function looksLikeTechnicalLegendLabel(value) {
  const label = normalizeLegendLabel(value);
  if (!label) return false;
  if (looksLikeStyleTokenLegendLabel(label)) return true;
  if (/^\d{1,4}$/u.test(label)) return true;
  return false;
}

function looksLikeStyleTokenLegendLabel(value) {
  const label = normalizeLegendLabel(value);
  if (!label) return false;
  if (/^#?[0-9a-f]{6}$/iu.test(label)) return true;
  return /^style[\s_-]*\d*$/iu.test(label);
}

function normalizeLegendLabel(value) {
  if (value === null || value === undefined || typeof value === "object") return "";
  return String(value).trim();
}

function normalizeHexColor(value) {
  const normalized = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizeLegendKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getPropertyValueByAlias(properties, aliases) {
  const lookup = new Map(Object.entries(properties).map(([key, value]) => [normalizeLegendKey(key), value]));
  const alias = aliases.map(normalizeLegendKey).find((key) => lookup.has(key));
  return alias ? lookup.get(alias) : null;
}

function toTitleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\S+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
