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
  "styleurl",
  "ogr style",
]);

export function isTechnicalStyleField(field) {
  const normalized = normalizeLegendKey(field).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const compact = normalized.replace(/\s+/g, "");
  return TECHNICAL_STYLE_FIELDS.has(normalized) || TECHNICAL_STYLE_FIELDS.has(compact) || String(field || "").startsWith("__");
}

export function normalizePublishedVectorLegend(record = null) {
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

  return {
    type: candidate.type === "continuous" ? "continuous" : "categorical",
    field,
    classes,
  };
}

export function buildSemanticLegendFromFeatures(features, styleField) {
  if (!styleField || isTechnicalStyleField(styleField)) return null;
  const classes = new Map();

  features.forEach((feature) => {
    const properties = feature?.properties || {};
    const rawLabel = getPropertyValueByAlias(properties, [styleField]);
    const label = normalizeLegendLabel(rawLabel);
    const color = normalizeHexColor(properties.__styleFill || properties.__styleLine || properties.__styleIcon);
    if (!label || !color || classes.has(label)) return;
    classes.set(label, {
      label,
      color,
      outlineColor: normalizeHexColor(properties.__styleLine || properties.__styleStroke) || color,
      order: getOrdinalLegendOrder(label),
    });
  });

  const ordered = [...classes.values()].sort(compareLegendClasses).slice(0, 24);
  return ordered.length > 1
    ? {
        type: "categorical",
        field: styleField,
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

function getOrdinalLegendOrder(label, fallback = 100) {
  return ORDINAL_LABEL_ORDER.get(normalizeLegendKey(label).replace(/\s+/g, " ").trim()) ?? fallback;
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
