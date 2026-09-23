import fs from "node:fs/promises";
import path from "node:path";

const BASE_DIR = path.resolve("data/base/vialidades");
const LEVEL_FILES = {
  1: path.join(BASE_DIR, "vialidades_nivel_1.geojson"),
  2: path.join(BASE_DIR, "vialidades_nivel_2.geojson"),
};
const MANIFEST_PATH = path.join(BASE_DIR, "vialidades_nivel_3_manifest.json");
const DIAGNOSTIC_PATH = path.join(BASE_DIR, "diagnostico_nombres_viales.json");
const CORRECTIONS_PATH = path.join(BASE_DIR, "correcciones_nombres_viales.json");
const DISPLAY_NAMES_PATH = path.join(BASE_DIR, "nombres_viales_mostrar.json");
const AUDIT_DATE = "2026-09-23";

const USELESS_NAME_VALUES = new Set([
  "",
  "sin nombre",
  "s/n",
  "sn",
  "n/a",
  "na",
  "n.d.",
  "nd",
  "no disponible",
  "no aplica",
]);

const HTML_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", "\""],
  ["apos", "'"],
  ["nbsp", " "],
  ["aacute", "á"],
  ["eacute", "é"],
  ["iacute", "í"],
  ["oacute", "ó"],
  ["uacute", "ú"],
  ["ntilde", "ñ"],
  ["Aacute", "Á"],
  ["Eacute", "É"],
  ["Iacute", "Í"],
  ["Oacute", "Ó"],
  ["Uacute", "Ú"],
  ["Ntilde", "Ñ"],
]);

function usefulName(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return !USELESS_NAME_VALUES.has(normalized);
}

function decodeHtmlEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (match, entity) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return HTML_ENTITIES.get(entity) ?? match;
  });
}

function hasMojibake(value) {
  return /Ã.|Â.|â[€\u0080-\u009f]?|�/.test(value);
}

function decodeMojibake(value) {
  if (!hasMojibake(value)) {
    return value;
  }
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  if (decoded.includes("�") || hasMojibake(decoded)) {
    return value;
  }
  return decoded;
}

function normalizeWhitespace(value) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeForComparison(value) {
  return normalizeWhitespace(String(value ?? ""))
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function buildDisplayName(originalValue) {
  if (originalValue === null || originalValue === undefined) {
    return "";
  }
  const original = String(originalValue);
  let display = original;
  display = decodeHtmlEntities(display);
  display = decodeMojibake(display);
  display = normalizeWhitespace(display);
  return usefulName(display) ? display : "";
}

function detectProblems(originalValue, displayName) {
  const problems = [];
  if (originalValue === null) {
    problems.push("null");
    return problems;
  }
  if (originalValue === undefined) {
    problems.push("undefined");
    return problems;
  }
  const original = String(originalValue);
  if (!usefulName(original)) {
    problems.push("sin_nombre");
  }
  if (/^\s|\s$/.test(original)) {
    problems.push("espacios_extremos");
  }
  if (/\s{2,}/.test(original)) {
    problems.push("espacios_duplicados");
  }
  if (/[\u0000-\u001f\u007f]/.test(original)) {
    problems.push("caracteres_control");
  }
  if (/&(#x[0-9a-f]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/.test(original)) {
    problems.push("html_entidad");
  }
  if (/<[a-z][\s\S]*>/i.test(original)) {
    problems.push("html_texto");
  }
  if (hasMojibake(original)) {
    problems.push("mojibake");
  }
  const letters = original.replace(/[^\p{L}]/gu, "");
  if (letters.length > 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    problems.push("mayusculas_mecanicas");
  }
  if (/^\d+[a-z]?$/i.test(original.trim())) {
    problems.push("solo_numero_o_clave");
  }
  if (/^(calle|avenida|av\.?|carretera|camino|andador|privada)$/i.test(original.trim())) {
    problems.push("generico");
  }
  if (displayName && original !== displayName) {
    problems.push("correccion_automatica_segura");
  }
  return [...new Set(problems)];
}

function getFirstCoordinate(geometry) {
  let cursor = geometry?.coordinates;
  while (Array.isArray(cursor) && Array.isArray(cursor[0])) {
    cursor = cursor[0];
  }
  if (!Array.isArray(cursor) || cursor.length < 2) {
    return null;
  }
  return [Number(cursor[0].toFixed(6)), Number(cursor[1].toFixed(6))];
}

function extendBbox(bbox, coordinates) {
  if (!Array.isArray(coordinates)) {
    return;
  }
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    bbox[0] = Math.min(bbox[0], coordinates[0]);
    bbox[1] = Math.min(bbox[1], coordinates[1]);
    bbox[2] = Math.max(bbox[2], coordinates[0]);
    bbox[3] = Math.max(bbox[3], coordinates[1]);
    return;
  }
  coordinates.forEach((child) => extendBbox(bbox, child));
}

function getBbox(geometry) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  extendBbox(bbox, geometry?.coordinates);
  return bbox.some((value) => !Number.isFinite(value))
    ? null
    : bbox.map((value) => Number(value.toFixed(6)));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value, { pretty = false } = {}) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

function initLevelSummary(level) {
  return {
    level: Number(level),
    featureInstances: 0,
    uniqueFeatures: 0,
    namedInstances: 0,
    unnamedInstances: 0,
    uniqueNames: 0,
    repeatedNames: 0,
    automaticCorrectionInstances: 0,
    automaticCorrectionUniqueFeatures: 0,
    needsOfficialSourceInstances: 0,
    ambiguousUnchangedInstances: 0,
    problemCounts: {},
  };
}

function incrementProblem(summary, problem) {
  summary.problemCounts[problem] = (summary.problemCounts[problem] || 0) + 1;
}

async function collectRoadFiles() {
  const manifest = await readJson(MANIFEST_PATH);
  return [
    { level: 1, filePath: LEVEL_FILES[1], relativePath: path.relative(process.cwd(), LEVEL_FILES[1]).replaceAll("\\", "/") },
    { level: 2, filePath: LEVEL_FILES[2], relativePath: path.relative(process.cwd(), LEVEL_FILES[2]).replaceAll("\\", "/") },
    ...manifest.chunks.map((chunk) => ({
      level: 3,
      chunkId: chunk.id,
      filePath: path.resolve(chunk.url),
      relativePath: chunk.url,
    })),
  ];
}

async function audit() {
  const files = await collectRoadFiles();
  const summaries = new Map([[1, initLevelSummary(1)], [2, initLevelSummary(2)], [3, initLevelSummary(3)]]);
  const uniqueByLevel = new Map([[1, new Set()], [2, new Set()], [3, new Set()]]);
  const uniqueNamesByLevel = new Map([[1, new Set()], [2, new Set()], [3, new Set()]]);
  const repeatedNamesByLevel = new Map([[1, new Map()], [2, new Map()], [3, new Map()]]);
  const correctionKeysByLevel = new Map([[1, new Set()], [2, new Set()], [3, new Set()]]);
  const correctionsByKey = new Map();
  const displayNamesByKey = {};
  const diagnosticCases = [];
  const ambiguousCases = [];
  let filesChanged = 0;

  for (const fileInfo of files) {
    const collection = await readJson(fileInfo.filePath);
    const summary = summaries.get(fileInfo.level);
    for (const [featureIndex, featureItem] of (collection.features || []).entries()) {
      const props = featureItem.properties || {};
      const original = props.nombre;
      const displayName = buildDisplayName(original);
      const problems = detectProblems(original, displayName);
      const stableId = props.id ?? props.ID_RED ?? `${fileInfo.relativePath}#${featureIndex}`;
      const stableKey = `${fileInfo.level}:${stableId}`;
      const normalizedName = normalizeForComparison(displayName || original || "");
      summary.featureInstances += 1;
      uniqueByLevel.get(fileInfo.level).add(stableKey);
      if (usefulName(original)) {
        summary.namedInstances += 1;
      } else {
        summary.unnamedInstances += 1;
      }
      if (normalizedName) {
        uniqueNamesByLevel.get(fileInfo.level).add(normalizedName);
        repeatedNamesByLevel.get(fileInfo.level).set(
          normalizedName,
          (repeatedNamesByLevel.get(fileInfo.level).get(normalizedName) || 0) + 1
        );
      }
      problems.forEach((problem) => incrementProblem(summary, problem));
      const hasSafeCorrection = displayName && displayName !== original;
      if (hasSafeCorrection) {
        summary.automaticCorrectionInstances += 1;
      }
      if (problems.some((problem) => ["mayusculas_mecanicas", "solo_numero_o_clave", "generico"].includes(problem))) {
        summary.needsOfficialSourceInstances += 1;
        summary.ambiguousUnchangedInstances += 1;
      }
      if (hasSafeCorrection) {
        correctionKeysByLevel.get(fileInfo.level).add(stableKey);
        displayNamesByKey[stableKey] = displayName;
        if (!correctionsByKey.has(stableKey)) {
          correctionsByKey.set(stableKey, {
            level: fileInfo.level,
            id: stableId,
            firstFile: fileInfo.relativePath,
            chunkId: fileInfo.chunkId ?? null,
            originalName: original,
            displayName,
            normalizedForComparison: normalizedName,
            source: "normalizacion-segura",
            confidence: "alta",
            problems: problems.filter((problem) => problem !== "correccion_automatica_segura"),
            geometryType: featureItem.geometry?.type ?? null,
            approximateCoordinate: getFirstCoordinate(featureItem.geometry),
            bbox: getBbox(featureItem.geometry),
            classification: props.tipo_vial ?? props.nivel_vial ?? null,
          });
        }
      }
      if (problems.length > 0 && diagnosticCases.length < 200) {
        diagnosticCases.push({
          level: fileInfo.level,
          id: stableId,
          file: fileInfo.relativePath,
          chunkId: fileInfo.chunkId ?? null,
          originalName: original ?? null,
          displayName: displayName || null,
          normalizedForComparison: normalizedName,
          problems,
          confidence: hasSafeCorrection ? "alta" : "pendiente",
          source: hasSafeCorrection ? "normalizacion-segura" : "requiere_fuente_oficial",
          geometryType: featureItem.geometry?.type ?? null,
          approximateCoordinate: getFirstCoordinate(featureItem.geometry),
          classification: props.tipo_vial ?? props.nivel_vial ?? null,
        });
      }
      if (!hasSafeCorrection && problems.some((problem) => ["mayusculas_mecanicas", "solo_numero_o_clave", "generico"].includes(problem)) && ambiguousCases.length < 200) {
        ambiguousCases.push({
          level: fileInfo.level,
          id: stableId,
          file: fileInfo.relativePath,
          originalName: original ?? null,
          problems,
          reason: "No se modifica sin identificador oficial o coincidencia espacial validada.",
        });
      }
    }
  }

  const manifest = await readJson(MANIFEST_PATH);

  for (const [level, summary] of summaries) {
    summary.uniqueFeatures = uniqueByLevel.get(level).size;
    summary.uniqueNames = uniqueNamesByLevel.get(level).size;
    summary.repeatedNames = [...repeatedNamesByLevel.get(level).values()].filter((count) => count > 1).length;
    summary.automaticCorrectionUniqueFeatures = correctionKeysByLevel.get(level).size;
  }

  const levels = Object.fromEntries([...summaries].map(([level, summary]) => [level, summary]));
  const correctionList = [...correctionsByKey.values()].sort((a, b) =>
    a.level - b.level || String(a.id).localeCompare(String(b.id), "es", { numeric: true })
  );
  const diagnostics = {
    generatedAt: AUDIT_DATE,
    script: "scripts/audit-vialidades-nombres.mjs",
    officialReference: {
      name: "Red Nacional de Caminos (RNC)",
      institutions: ["INEGI", "IMT", "SICT"],
      url: "https://www.inegi.org.mx/programas/rnc/",
      latestObservedRelease: "RNC 2025, consultada en fuentes oficiales durante septiembre de 2026",
      dataDictionaryUrl: "https://inegi.org.mx/contenidos/productos/prod_serv/contenidos/espanol/bvinegi/productos/nueva_estruc/889463927457.pdf",
      officialNameField: "Nombre",
      officialIdField: "Id_Red",
      officialClassField: "Tipo_Vial",
      crs: "EPSG:4326 en derivados web; la RNC oficial publica datos georreferenciados nacionales",
      useInThisAudit: "Referencia semantica. No se reemplazan nombres por RNC sin identificador comun o comparacion espacial validada.",
    },
    totals: {
      featureInstances: [...summaries.values()].reduce((sum, item) => sum + item.featureInstances, 0),
      uniqueFeatures: [...summaries.values()].reduce((sum, item) => sum + item.uniqueFeatures, 0),
      namedInstances: [...summaries.values()].reduce((sum, item) => sum + item.namedInstances, 0),
      unnamedInstances: [...summaries.values()].reduce((sum, item) => sum + item.unnamedInstances, 0),
      automaticCorrectionInstances: [...summaries.values()].reduce((sum, item) => sum + item.automaticCorrectionInstances, 0),
      automaticCorrectionUniqueFeatures: [...summaries.values()].reduce((sum, item) => sum + item.automaticCorrectionUniqueFeatures, 0),
    },
    levels,
    vial3Manifest: {
      sourceFeatureCount: manifest.sourceFeatureCount,
      renderFeatureCount: manifest.renderFeatureCount,
      chunkCount: manifest.chunks.length,
      featureInstancesInChunks: levels[3].featureInstances,
      namedInstancePercent: Number(((levels[3].namedInstances / levels[3].featureInstances) * 100).toFixed(2)),
      unnamedInstancePercent: Number(((levels[3].unnamedInstances / levels[3].featureInstances) * 100).toFixed(2)),
    },
    rules: {
      safeAutomaticCorrections: [
        "decodificacion de mojibake UTF-8 leido como Latin-1/CP1252",
        "entidades HTML basicas",
        "espacios duplicados, extremos y caracteres de control invisibles",
      ],
      notAutomaticallyChanged: [
        "acentos no demostrables por codificacion",
        "nombres propios, toponimos, abreviaturas, claves y mayusculas",
        "variantes ortograficas sin identificador oficial comun",
      ],
      displayedField: "nombre_mostrar",
      preservedField: "nombre",
    },
    diagnosticCases,
    ambiguousCases,
  };
  const corrections = {
    generatedAt: AUDIT_DATE,
    script: "scripts/audit-vialidades-nombres.mjs",
    correctionCount: correctionList.length,
    corrections: correctionList,
  };
  const displayNames = {
    generatedAt: AUDIT_DATE,
    script: "scripts/audit-vialidades-nombres.mjs",
    keyFormat: "nivel:id",
    correctionCount: Object.keys(displayNamesByKey).length,
    names: Object.fromEntries(Object.entries(displayNamesByKey).sort(([a], [b]) => a.localeCompare(b, "es", { numeric: true }))),
  };

  await writeJson(DIAGNOSTIC_PATH, diagnostics, { pretty: true });
  await writeJson(CORRECTIONS_PATH, corrections, { pretty: true });
  await writeJson(DISPLAY_NAMES_PATH, displayNames);
  return { diagnostics, corrections, filesChanged };
}

const result = await audit();
console.log(JSON.stringify({
  generatedAt: result.diagnostics.generatedAt,
  filesChanged: result.filesChanged,
  totals: result.diagnostics.totals,
  vial3: result.diagnostics.vial3Manifest,
  correctionCount: result.corrections.correctionCount,
}, null, 2));
