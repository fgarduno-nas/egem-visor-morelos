export const GRADUATED_CLASS_COLORS = ["#166534", "#65A30D", "#FACC15", "#F97316", "#DC2626"];
export const GRADUATED_CLASS_LABELS = ["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"];
export const INSTITUTIONAL_HAZARD_LABELS = ["Muy alto", "Alto", "Medio", "Bajo", "Muy bajo"];
export const INSTITUTIONAL_HAZARD_COLORS = {
  "Muy alto": "#DC2626",
  Alto: "#F97316",
  Medio: "#FACC15",
  Bajo: "#65A30D",
  "Muy bajo": "#166534",
};

const CONTINUOUS_UNIQUE_THRESHOLD = 12;
const CONTINUOUS_UNIQUE_RATIO = 0.2;
const NUMERIC_SAMPLE_RATIO = 0.85;

export function isPresentValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "object") return false;
  return String(value).trim() !== "";
}

export function toFiniteNumber(value) {
  if (!isPresentValue(value)) return null;
  const normalized = String(value).trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/u.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

export function analyzeStyleField(features, field) {
  const rawValues = [];
  const numericValues = [];

  features.forEach((feature) => {
    const value = getPropertyValueByAlias(feature.properties || {}, [field]);
    if (!isPresentValue(value) || containsHtmlMarkup(value)) return;
    rawValues.push(value);
    const numeric = toFiniteNumber(value);
    if (numeric !== null) numericValues.push(numeric);
  });

  const uniqueValues = new Set(rawValues.map(normalizeStyleValueKey));
  const numericRatio = rawValues.length ? numericValues.length / rawValues.length : 0;
  const isMostlyNumeric = rawValues.length > 0 && numericRatio >= NUMERIC_SAMPLE_RATIO;
  const uniqueRatio = rawValues.length ? uniqueValues.size / rawValues.length : 0;
  const isContinuous =
    isMostlyNumeric &&
    uniqueValues.size > CONTINUOUS_UNIQUE_THRESHOLD &&
    uniqueRatio >= CONTINUOUS_UNIQUE_RATIO;

  return {
    field,
    validCount: rawValues.length,
    uniqueCount: uniqueValues.size,
    uniqueValues: [...uniqueValues],
    numericCount: numericValues.length,
    numericValues,
    numericRatio,
    uniqueRatio,
    type: isContinuous ? "continuous" : "categorical",
  };
}

export function buildContinuousClassification(field, numericValues, classCount = 5) {
  const values = numericValues.filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;

  const min = values[0];
  const max = values[values.length - 1];

  if (min === max) {
    return {
      type: "single",
      method: "single-value",
      field,
      min,
      max,
      cuts: [],
      expression: GRADUATED_CLASS_COLORS[2],
      legend: [
        {
          label: "Valor único",
          color: GRADUATED_CLASS_COLORS[2],
          min,
          max,
        },
      ],
    };
  }

  const quantileCuts = buildQuantileCuts(values, classCount);
  const validQuantileCuts = hasUsableClassCuts(quantileCuts, min, max);
  const cuts = validQuantileCuts
    ? quantileCuts
    : buildEqualIntervalCuts(min, max, classCount);
  const method = validQuantileCuts ? "quantiles" : "equal-interval";

  return {
    type: "continuous",
    method,
    field,
    min,
    max,
    cuts,
    expression: buildStepExpression(field, cuts),
    legend: buildGraduatedLegend(min, max, cuts),
  };
}

export function buildStepExpression(field, cuts) {
  const expression = ["step", ["to-number", ["get", field]], GRADUATED_CLASS_COLORS[0]];
  cuts.forEach((cut, index) => {
    expression.push(cut, GRADUATED_CLASS_COLORS[index + 1]);
  });
  return expression;
}

export function buildQuantileCuts(values, classCount) {
  const cuts = [];
  for (let index = 1; index < classCount; index += 1) {
    cuts.push(values[Math.floor((values.length - 1) * (index / classCount))]);
  }
  return cuts;
}

export function buildEqualIntervalCuts(min, max, classCount) {
  const step = (max - min) / classCount;
  return Array.from({ length: classCount - 1 }, (_item, index) => min + step * (index + 1));
}

export function hasStrictlyIncreasingCuts(cuts) {
  return cuts.every((cut, index) => Number.isFinite(cut) && (index === 0 || cut > cuts[index - 1]));
}

export function hasUsableClassCuts(cuts, min, max) {
  return hasStrictlyIncreasingCuts(cuts) && cuts[0] > min && cuts[cuts.length - 1] < max;
}

export function buildGraduatedLegend(min, max, cuts) {
  const bounds = [min, ...cuts, max];
  return GRADUATED_CLASS_LABELS.map((label, index) => ({
    label,
    color: GRADUATED_CLASS_COLORS[index],
    min: bounds[index],
    max: bounds[index + 1],
  }));
}

export function getInstitutionalHazardLabel(value) {
  const normalized = normalizeInstitutionalHazardKey(value);
  const aliases = {
    "muy alto": "Muy alto",
    muy_alto: "Muy alto",
    muyalto: "Muy alto",
    "5": "Muy alto",
    alto: "Alto",
    "4": "Alto",
    medio: "Medio",
    mediano: "Medio",
    "3": "Medio",
    bajo: "Bajo",
    "2": "Bajo",
    "muy bajo": "Muy bajo",
    muy_bajo: "Muy bajo",
    muybajo: "Muy bajo",
    "1": "Muy bajo",
  };
  if (aliases[normalized]) return aliases[normalized];
  if (normalized.includes("muy alto")) return "Muy alto";
  if (normalized.includes("muy bajo")) return "Muy bajo";
  if (normalized.includes("alto")) return "Alto";
  if (normalized.includes("medio") || normalized.includes("mediano")) return "Medio";
  if (normalized.includes("bajo")) return "Bajo";
  return null;
}

export function isInstitutionalHazardField(field) {
  const normalized = normalizeAttributeKey(field).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return [
    "intensidad",
    "riesgo",
    "peligro",
    "nivel",
    "clasificacion",
    "fen clasif",
    "vulnerabilidad",
  ].includes(normalized);
}

export function buildInstitutionalHazardLegend(values) {
  const presentLabels = new Set(
    values
      .map(getInstitutionalHazardLabel)
      .filter(Boolean)
  );
  const classes = INSTITUTIONAL_HAZARD_LABELS
    .filter((label) => presentLabels.has(label))
    .map((label) => ({
      label,
      color: INSTITUTIONAL_HAZARD_COLORS[label],
    }));

  return classes.length
    ? {
        type: "institutional-hazard",
        field: "Clasificacion de peligro",
        classes,
      }
    : null;
}

export function getPropertyValueByAlias(properties, aliases) {
  const lookup = new Map(
    Object.entries(properties).map(([key, value]) => [normalizeAttributeKey(key), value])
  );
  const alias = aliases.map(normalizeAttributeKey).find((key) => lookup.has(key));
  return alias ? lookup.get(alias) : null;
}

export function normalizeAttributeKey(key) {
  return String(key || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function normalizeStyleValueKey(value) {
  return normalizeAttributeKey(value).replace(/\s+/g, " ").trim();
}

function normalizeInstitutionalHazardKey(value) {
  return normalizeAttributeKey(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b(riesgo|peligro|nivel|clasificacion|clase)\b/gu, "")
    .replace(/[():;,%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsHtmlMarkup(value) {
  const text = String(value || "").toLowerCase();
  return ["<html", "<table", "<tr", "<td"].some((token) => text.includes(token));
}
