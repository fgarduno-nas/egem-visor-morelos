import { normalizeHexColor } from "./color-utils.js";

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

const ORDINAL_STYLE_COLOR_ORDER = new Map([
  ["#006100", 1],
  ["#38a800", 1],
  ["#7aab00", 2],
  ["#8ccc48", 2],
  ["#ffff00", 3],
  ["#ff9900", 4],
  ["#ffc300", 4],
  ["#ff2200", 5],
  ["#ff0000", 5],
  ["#e31a1c", 5],
]);

export const NO_APLICA_COLOR = "#808080";

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
  "Intens_uni",
  "Magni_uni",
  "Magni_unid",
  "Magnitud",
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
  if (!candidate) {
    return buildBestSemanticLegendFromFeatures(options.features || [], {
      preferredField: options.preferredField,
      record,
    });
  }

  const classes = dedupeLegendClasses(assignVectorLegendGroupOrder(getLegendClasses(candidate)
    .map((item, index) => normalizeLegendClass(item, index))
    .filter((item) => item.label && item.color))
    .sort(compareLegendClasses)
    .map(stripLegendInternalOrderFields))
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

  const semanticLegend = buildBestSemanticLegendFromFeatures(options.features || [], {
    preferredField: options.preferredField,
    record,
  });

  const invalidLegend = isSemanticallyInvalidLegend(legend, { ...options, semanticLegend });
  if (!invalidLegend && legendMatchesFeatureStyles(legend, options.features || [])) {
    return legend;
  }

  return semanticLegend || (invalidLegend ? null : legend);
}

export function normalizePublishedRasterLegend(record = null) {
  const candidate = getRasterLegendCandidates(record).find((legend) => Array.isArray(getLegendClasses(legend)));
  if (!candidate) return null;

  const classes = dedupeLegendClasses(getLegendClasses(candidate)
    .map((item, index) => normalizeLegendClass(item, index))
    .filter((item) => item.label && item.color)
    .sort(compareLegendClasses))
    .slice(0, 24);

  if (!classes.length) return null;

  return {
    type: "raster",
    field: candidate.field || candidate.title || candidate.name || null,
    classes,
  };
}

export function isNoAplicaLegendValue(value) {
  return normalizeLegendComparisonText(value) === "no aplica";
}

export function resolveDisplayColor(value, sourceColor) {
  return isNoAplicaLegendValue(value) ? NO_APLICA_COLOR : sourceColor;
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
  if (!classes.length) return false;

  const labels = classes.map((item) => normalizeLegendLabel(item.label)).filter(Boolean);
  const uniqueLabels = new Set(labels.map((label) => normalizeLegendKey(label)));
  const uniqueColors = new Set(classes.map((item) => normalizeHexColor(item.color)).filter(Boolean));

  const repeatedSingleLabel = uniqueLabels.size === 1;
  const fieldIsGeneric = isTechnicalStyleField(legend.field) || GENERIC_LEGEND_FIELDS.has(normalizeLegendKey(legend.field));
  const hasTechnicalLabel = labels.some(looksLikeTechnicalLegendLabel);
  const hasStyleTokenLabel = labels.some(looksLikeStyleTokenLegendLabel);
  const hasSemanticEvidence = Boolean(options.semanticLegend) || buildBestSemanticLegendFromFeatures(options.features || [], {
    preferredField: options.preferredField,
    record: options.record,
    validateOnly: true,
  });

  return (
    hasStyleTokenLabel ||
    ((fieldIsGeneric || hasTechnicalLabel) && Boolean(hasSemanticEvidence)) ||
    (uniqueColors.size > 1 && repeatedSingleLabel && (fieldIsGeneric || hasTechnicalLabel || Boolean(hasSemanticEvidence)))
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
    if (legend?.classes?.length) return options.validateOnly ? true : legend;
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
    const rawLabel = getSemanticPropertyValueByAlias(properties, labelAliases);
    const label = normalizeOrdinalLegendLabel(rawLabel, fieldTitle);
    const sourceColor = normalizeHexColor(properties.__styleFill || properties.__styleLine || properties.__styleIcon);
    const color = resolveDisplayColor(label, sourceColor);
    if (!label || !color || classes.has(label)) return;
    classes.set(label, {
      label,
      color,
      outlineColor: resolveDisplayColor(label, normalizeHexColor(properties.__styleLine || properties.__styleStroke) || sourceColor),
      order: getLegendClassOrder(properties, label),
    });
  });

  const ordered = [...classes.values()].sort(compareLegendClasses).slice(0, 24);
  return ordered.length
    ? {
        type: "categorical",
        field: fieldTitle,
        styleField,
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
  const label = normalizeLegendLabel(item?.originalLabel ?? item?.label ?? item?.name ?? item?.value ?? item?.title);
  const sourceColor = normalizeHexColor(item?.originalColor || item?.color || item?.fillColor || item?.fill || item?.strokeColor || item?.outlineColor);
  const color = resolveDisplayColor(label, sourceColor);
  const sourceOutlineColor = normalizeHexColor(item?.outlineColor || item?.strokeColor || item?.stroke) || sourceColor;
  const outlineColor = resolveDisplayColor(label, sourceOutlineColor);
  const explicitOrder = Number(item?.displayOrder ?? item?.order);
  const sourceOrder = Number(item?.sourceOrder ?? item?.order);
  const rawValue = item?.value;
  const value = normalizeLegendLabel(rawValue);
  const description = normalizeLegendLabel(item?.description ?? item?.summary ?? item?.text);
  return {
    label: normalizeLegendLabel(item?.displayLabel) || label,
    displayLabel: normalizeLegendLabel(item?.displayLabel) || label,
    originalLabel: label,
    color,
    originalColor: color,
    displayColor: normalizeHexColor(item?.displayColor) || color,
    outlineColor,
    order: Number.isFinite(explicitOrder) ? explicitOrder : getOrdinalLegendOrder(label, index),
    displayOrder: Number.isFinite(explicitOrder) ? explicitOrder : getOrdinalLegendOrder(label, index),
    sourceOrder: Number.isFinite(sourceOrder) ? sourceOrder : null,
    __sourceIndex: index,
    value: value && !legendTextsAreEquivalent(label, value) ? rawValue : null,
    originalValue: normalizeLegendLabel(item?.originalValue) || value || rawValue || null,
    min: item?.min,
    max: item?.max,
    styleUrl: item?.styleUrl || null,
    styleId: item?.styleId || null,
    iconHref: item?.iconHref || null,
    symbolType: item?.symbolType || null,
    group: item?.group || item?.folder || null,
    folder: item?.folder || item?.group || null,
    geometryRole: item?.geometryRole || null,
    legendField: item?.legendField || null,
    description: description && !legendTextsAreEquivalent(label, description) ? description : null,
  };
}

function assignVectorLegendGroupOrder(classes) {
  const groupOrder = new Map();
  return classes.map((item) => {
    const groupKey = [
      item.group || item.folder || "sin-grupo",
      item.legendField || "sin-campo",
    ].map(normalizeLegendComparisonText).join("|");
    if (!groupOrder.has(groupKey)) groupOrder.set(groupKey, groupOrder.size);
    return { ...item, __groupIndex: groupOrder.get(groupKey) };
  });
}

function stripLegendInternalOrderFields(item) {
  const {
    __sourceIndex: _sourceIndex,
    __groupIndex: _groupIndex,
    ...publicItem
  } = item;
  return publicItem;
}

function compareLegendClasses(a, b) {
  const groupA = Number.isFinite(Number(a.__groupIndex)) ? Number(a.__groupIndex) : 0;
  const groupB = Number.isFinite(Number(b.__groupIndex)) ? Number(b.__groupIndex) : 0;
  if (groupA !== groupB) return groupA - groupB;
  return a.order - b.order || (a.__sourceIndex ?? 0) - (b.__sourceIndex ?? 0) || String(a.label).localeCompare(String(b.label), "es");
}

function dedupeLegendClasses(classes) {
  const seen = new Set();
  return classes.filter((item) => {
    const signature = [
      normalizeLegendComparisonText(item.label),
      normalizeHexColor(item.color) || "",
      normalizeHexColor(item.outlineColor) || "",
      normalizeLegendComparisonText(item.value),
      normalizeLegendComparisonText(item.min),
      normalizeLegendComparisonText(item.max),
      normalizeLegendComparisonText(item.description),
    ].join("|");
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
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
    const value = normalizeLegendLabel(getSemanticPropertyValueByAlias(feature?.properties || {}, CONCEPT_FIELDS));
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
    return ["Intensidad", "Intensid_1", "Intensidad_1", "Intensid1", "Intens_uni"];
  }
  if (normalized === "magnitud" || normalized === "magni uni" || normalized === "magni unid") {
    return ["Magnitud", "Magni_uni", "Magni_unid", "Magni_unidad"];
  }
  return [field];
}

function getLegendClassOrder(properties, label) {
  const rawGridCode = getSemanticPropertyValueByAlias(properties, ["gridcode", "GridCode", "grid_code"]);
  const gridCode = Number(rawGridCode);
  if (rawGridCode !== null && rawGridCode !== undefined && String(rawGridCode).trim() !== "" && Number.isFinite(gridCode)) return gridCode;
  return getOrdinalLegendOrder(label);
}

export function getOrdinalLegendOrder(label, fallback = 100) {
  return ORDINAL_LABEL_ORDER.get(normalizeLegendKey(label).replace(/\s+/g, " ").trim()) ?? fallback;
}

export function getFeatureOrdinalLegendRank(featureOrProperties = null) {
  const properties = featureOrProperties?.properties || featureOrProperties || {};
  const rawLabel = getSemanticPropertyValueByAlias(properties, [
    "Intensidad",
    "Intensid_1",
    "Intensidad_1",
    "Intensid1",
    "Magni_uni",
    "Magni_unid",
    "Magnitud",
  ]);
  return getOrdinalLegendOrder(rawLabel, 0);
}

export function getFeatureVisualPriorityRank(featureOrProperties = null) {
  const properties = featureOrProperties?.properties || featureOrProperties || {};
  const styleColor = normalizeHexColor(properties.__styleFill || properties.__styleLine || properties.__styleIcon);
  return ORDINAL_STYLE_COLOR_ORDER.get(styleColor) || getFeatureOrdinalLegendRank(properties);
}

export function getFeatureStyleLegendLabel(featureOrProperties = null, legend = null) {
  const properties = featureOrProperties?.properties || featureOrProperties || {};
  const styleColor = normalizeHexColor(properties.__styleFill || properties.__styleLine || properties.__styleIcon);
  if (!styleColor || !Array.isArray(legend?.classes)) return null;
  return legend.classes.find((item) => normalizeHexColor(item?.color) === styleColor)?.label || null;
}

export function pickTopFeatureByVisualPriority(features = []) {
  const candidates = Array.isArray(features) ? features : [];
  if (!candidates.length) return null;
  return candidates
    .map((feature, index) => ({
      feature,
      index,
      rank: getFeatureVisualPriorityRank(feature),
    }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)[0].feature;
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
  const normalized = normalizeLegendComparisonText(label);
  if (normalized === "clase" || /^clase sin etiqueta \d+$/u.test(normalized)) return true;
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

export function normalizeLegendComparisonText(value) {
  return decodeCommonHtmlEntities(String(value ?? ""))
    .replace(/<[^>]*>/gu, " ")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/gu, "")
    .replace(/\u00a0/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.:;,]+$/u, "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase();
}

export function legendTextsAreEquivalent(a, b) {
  const left = normalizeLegendComparisonText(a);
  const right = normalizeLegendComparisonText(b);
  return Boolean(left && right && left === right);
}

function decodeCommonHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (match, code) => decodeHtmlCodePoint(code, 10) || match)
    .replace(/&#x([0-9a-f]+);/giu, (match, code) => decodeHtmlCodePoint(code, 16) || match);
}

function decodeHtmlCodePoint(code, radix) {
  const numeric = parseInt(code, radix);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 0x10ffff) return "";
  try {
    return String.fromCodePoint(numeric);
  } catch (_error) {
    return "";
  }
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

function getSemanticPropertyValueByAlias(properties, aliases) {
  const direct = getPropertyValueByAlias(properties, aliases);
  if (normalizeLegendLabel(direct)) return direct;

  const description = getPropertyValueByAlias(properties, ["Description", "description"]);
  const descriptionAttributes = parseDescriptionAttributes(description);
  return getPropertyValueByAlias(descriptionAttributes, aliases);
}

function parseDescriptionAttributes(description) {
  const html = decodeCommonHtmlEntities(String(description || ""));
  if (!html.trim()) return {};

  const attributes = {};
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/giu;
  let rowMatch = null;
  while ((rowMatch = rowRegex.exec(html))) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/giu)]
      .map((cell) => normalizeLegendLabel(decodeCommonHtmlEntities(cell[1]).replace(/<[^>]*>/gu, " ")));
    if (cells.length >= 2 && cells[0] && cells[1]) {
      attributes[cells[0].replace(/:$/u, "").trim()] = cells[1];
    }
  }

  return attributes;
}

function legendMatchesFeatureStyles(legend, features = []) {
  if (!Array.isArray(features) || !features.length || !legend?.classes?.length) return true;
  const legendColorsByLabel = new Map(
    legend.classes.map((item) => [normalizeLegendComparisonText(item.label), normalizeHexColor(item.color)])
  );
  let checked = 0;
  for (const feature of features) {
    const label = getSemanticPropertyValueByAlias(feature?.properties || {}, getSemanticFieldAliases(legend.field));
    const legendColor = legendColorsByLabel.get(normalizeLegendComparisonText(label));
    if (!legendColor) continue;
    const featureColor = normalizeHexColor(feature?.properties?.__styleFill || feature?.properties?.__styleLine || feature?.properties?.__styleIcon);
    if (!featureColor) continue;
    checked += 1;
    if (featureColor !== legendColor) return false;
  }
  return true;
}

function toTitleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\S+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
