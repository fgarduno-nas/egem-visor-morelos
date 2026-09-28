const INSTITUTIONAL_PHENOMENA = [
  {
    key: "category:geologicos",
    label: "Geológicos",
    aliases: ["geologicos", "geológicos"],
  },
  {
    key: "category:hidrometeorologicos",
    label: "Hidrometeorológicos",
    aliases: ["hidrometeorologicos", "hidrometeorológicos"],
  },
  {
    key: "category:quimico-tecnologicos",
    label: "Químico-tecnológicos",
    aliases: ["quimico-tecnologicos", "quimico tecnológicos", "quimicos-tecnologicos", "químicos tecnológicos"],
  },
  {
    key: "category:sanitario-ecologico",
    label: "Sanitario-ecológico",
    aliases: ["sanitario-ecologico", "sanitario ecológico", "sanitario ecologico"],
  },
  {
    key: "category:socio-organizativos",
    label: "Socio-organizativos",
    aliases: ["socio-organizativos", "socio organizativos", "socio-organizativo", "socio organizativo"],
  },
  {
    key: "category:astronomicos",
    label: "Astronómicos",
    aliases: ["astronomicos", "astronómicos"],
  },
  {
    key: "category:limites",
    label: "Límites",
    aliases: ["limites", "límites"],
  },
];

const PHENOMENON_BY_NORMALIZED_VALUE = buildPhenomenonIndex();

export function normalizePhenomenonForDisplay(value) {
  const raw = normalizeOptionalString(value);
  if (!raw) {
    return {
      technicalKey: null,
      displayLabel: "Sin clasificar",
      recognized: false,
    };
  }

  const normalized = normalizePhenomenonLookupValue(raw);
  const matched = PHENOMENON_BY_NORMALIZED_VALUE.get(normalized);
  if (matched) {
    return {
      technicalKey: matched.key,
      displayLabel: matched.label,
      recognized: true,
    };
  }

  const withoutPrefix = raw.replace(/^category\s*:\s*/iu, "").trim();
  const safeLabel = buildSafeUnknownPhenomenonLabel(withoutPrefix || raw);
  return {
    technicalKey: raw,
    displayLabel: safeLabel || "Sin clasificar",
    recognized: false,
  };
}

export function getPhenomenonSearchTokens(value) {
  const normalized = normalizePhenomenonForDisplay(value);
  const tokens = new Set();
  [
    value,
    normalized.technicalKey,
    normalized.displayLabel,
    normalized.technicalKey?.replace(/^category:/u, ""),
  ].forEach((candidate) => {
    const normalizedCandidate = normalizePhenomenonLookupValue(candidate);
    if (normalizedCandidate) tokens.add(normalizedCandidate);
  });
  return Array.from(tokens);
}

export function normalizePhenomenonLookupValue(value) {
  const text = normalizeOptionalString(value);
  if (!text) return "";
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/^category\s*:\s*/u, "category:")
    .replace(/[_\s]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/\s*:\s*/gu, ":")
    .trim();
}

function buildPhenomenonIndex() {
  const index = new Map();
  for (const item of INSTITUTIONAL_PHENOMENA) {
    [item.key, item.key.replace(/^category:/u, ""), ...item.aliases].forEach((value) => {
      const normalized = normalizePhenomenonLookupValue(value);
      if (normalized) index.set(normalized, item);
      const categoryNormalized = normalizePhenomenonLookupValue(`category:${value}`);
      if (categoryNormalized) index.set(categoryNormalized, item);
    });
  }
  return index;
}

function buildSafeUnknownPhenomenonLabel(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return "";
  const cleaned = normalized
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned || cleaned === "[object Object]") return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

function stripDiacritics(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/gu, "");
}
