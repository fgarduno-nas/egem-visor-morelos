import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile, readdir, stat } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SOURCE_URL =
  "https://www.inegi.org.mx/contenidos/programas/ccpv/2020/datosabiertos/iter/iter_17_cpv2020_csv.zip";
const ZIP_NAME = "iter_17_cpv2020_csv.zip";
const SOURCE_NAME = "INEGI, Censo de Poblacion y Vivienda 2020, ITER";
const CENSUS_DATE = "2020";
const OUTPUT_GEOJSON = path.resolve("data/base/localidades_morelos.geojson");
const OUTPUT_DIAGNOSTIC = path.resolve("data/base/localidades_morelos_diagnostico.json");
const OUTPUT_README = path.resolve("data/base/README-localidades.md");
const MORELOS_BOUNDS_WITH_MARGIN = {
  minLon: -99.65,
  maxLon: -98.45,
  minLat: 18.25,
  maxLat: 19.20,
};

const REQUIRED_FIELDS = [
  "ENTIDAD",
  "NOM_ENT",
  "MUN",
  "NOM_MUN",
  "LOC",
  "NOM_LOC",
  "LONGITUD",
  "LATITUD",
  "ALTITUD",
  "POBTOT",
];

async function main() {
  const generatedAt = new Date().toISOString();
  const tempDir = path.join(os.tmpdir(), `egem_localidades_morelos_${Date.now()}_`);
  await mkdir(tempDir, { recursive: true });
  const zipPath = path.join(tempDir, ZIP_NAME);

  try {
    await downloadFile(SOURCE_URL, zipPath);
    const zipSha256 = await sha256File(zipPath);
    expandZip(zipPath, tempDir);

    const csvPath = await findFile(tempDir, (entry) =>
      /^conjunto_de_datos_iter_17csv20\.csv$/i.test(entry),
    );
    const csvBuffer = await readFile(csvPath);
    const encoding = detectEncoding(csvBuffer);
    const csvText = csvBuffer.toString(encoding);
    const { headers, records } = parseCsv(csvText);

    const missingFields = REQUIRED_FIELDS.filter((field) => !headers.includes(field));
    if (missingFields.length) {
      throw new Error(`Campos fuente faltantes: ${missingFields.join(", ")}`);
    }

    const { features, diagnostic } = buildLocalidades(records, headers, {
      generatedAt,
      csvPath,
      encoding,
      zipSha256,
    });

    const geojson = {
      type: "FeatureCollection",
      name: "Localidades oficiales de Morelos 2020",
      metadata: {
        dataset: "Localidades oficiales de Morelos",
        source: SOURCE_NAME,
        sourceUrl: SOURCE_URL,
        zipName: ZIP_NAME,
        csvName: path.basename(csvPath),
        censusDate: CENSUS_DATE,
        generatedAt,
        crs: "EPSG:4326",
        totalFeatures: features.length,
        tierCounts: diagnostic.localidadesPorTier,
        cabecerasCount: diagnostic.cabecerasConfirmadas.length,
        coordinateMethod:
          "Conversion reproducible de coordenadas ITER en grados, minutos y segundos a grados decimales WGS 84; longitud oeste negativa; GeoJSON en orden [longitud, latitud].",
        methodology:
          "Se filtraron totales estatales, totales municipales, agregados 9998/9999, nombres vacios, coordenadas invalidas y coordenadas fuera del margen territorial de Morelos. No se eliminaron localidades por poblacion.",
      },
      features,
    };

    await mkdir(path.dirname(OUTPUT_GEOJSON), { recursive: true });
    await writeJson(OUTPUT_GEOJSON, geojson);
    await writeJson(OUTPUT_DIAGNOSTIC, diagnostic);
    await writeFile(OUTPUT_README, buildReadme(diagnostic), "utf8");

    console.log(`GeoJSON: ${OUTPUT_GEOJSON}`);
    console.log(`Diagnostico: ${OUTPUT_DIAGNOSTIC}`);
    console.log(`README: ${OUTPUT_README}`);
    console.log(`Registros finales: ${features.length}`);
    console.log(`SHA-256 ZIP: ${zipSha256}`);
  } finally {
    if (process.env.EGEM_KEEP_LOCALIDADES_TEMP === "1") {
      console.warn(`Temporal conservado para diagnostico: ${tempDir}`);
    } else {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

function buildLocalidades(records, headers, context) {
  const removed = {
    entidadNoMorelos: 0,
    totalEstatal: 0,
    totalMunicipalLoc0000: 0,
    agregadoLoc9998: 0,
    agregadoLoc9999: 0,
    nombreInvalido: 0,
    coordenadasInvalidas: 0,
    coordenadasFueraDeMargen: 0,
  };
  const warnings = [];
  const candidates = [];
  const duplicateKeys = new Map();
  const repeatedByMunicipality = new Map();
  const repeatedAcrossMunicipalities = new Map();
  const seenMunicipalities = new Map();

  for (const record of records) {
    const ent = clean(record.ENTIDAD);
    const mun = clean(record.MUN);
    const loc = clean(record.LOC);
    const name = clean(record.NOM_LOC);

    if (ent !== "17") {
      removed.entidadNoMorelos += 1;
      continue;
    }
    if (mun === "000" && loc === "0000") {
      removed.totalEstatal += 1;
      continue;
    }
    if (loc === "0000") {
      removed.totalMunicipalLoc0000 += 1;
      continue;
    }
    if (loc === "9998") {
      removed.agregadoLoc9998 += 1;
      continue;
    }
    if (loc === "9999") {
      removed.agregadoLoc9999 += 1;
      continue;
    }
    if (!name || /^total\b/i.test(name)) {
      removed.nombreInvalido += 1;
      continue;
    }

    const longitude = parseDms(record.LONGITUD, "W");
    const latitude = parseDms(record.LATITUD, "N");
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      removed.coordenadasInvalidas += 1;
      continue;
    }
    if (!withinBounds(longitude, latitude)) {
      removed.coordenadasFueraDeMargen += 1;
      continue;
    }

    const munPadded = mun.padStart(3, "0");
    const locPadded = loc.padStart(4, "0");
    const cvegeo = `${ent}${munPadded}${locPadded}`;
    const pobtot = parseInteger(record.POBTOT);
    const altitud = parseInteger(record.ALTITUD);
    const esCabecera = locPadded === "0001";
    const labelTier = tierForPopulation(pobtot);
    const normalizedName = normalizeName(name);

    seenMunicipalities.set(munPadded, clean(record.NOM_MUN));
    addMapValue(duplicateKeys, cvegeo, name);
    addMapValue(repeatedByMunicipality, `${munPadded}|${normalizedName}`, cvegeo);
    addMapValue(repeatedAcrossMunicipalities, normalizedName, `${munPadded}|${cvegeo}`);

    candidates.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [roundCoordinate(longitude), roundCoordinate(latitude)],
      },
      properties: {
        CVE_ENT: ent,
        CVE_MUN: munPadded,
        CVE_LOC: locPadded,
        CVEGEO: cvegeo,
        NOM_ENT: clean(record.NOM_ENT),
        NOM_MUN: clean(record.NOM_MUN),
        NOM_LOC: name,
        POBTOT: pobtot,
        ALTITUD: altitud,
        esCabecera,
        labelTier,
        labelPriority: null,
        source: SOURCE_NAME,
      },
    });
  }

  candidates.sort((a, b) => {
    const populationDelta = b.properties.POBTOT - a.properties.POBTOT;
    if (populationDelta) return populationDelta;
    if (a.properties.esCabecera !== b.properties.esCabecera) return a.properties.esCabecera ? -1 : 1;
    return a.properties.CVEGEO.localeCompare(b.properties.CVEGEO);
  });
  candidates.forEach((feature, index) => {
    feature.properties.labelPriority = index + 1;
  });
  candidates.sort((a, b) => a.properties.CVEGEO.localeCompare(b.properties.CVEGEO));

  const cabeceras = candidates
    .filter((feature) => feature.properties.esCabecera)
    .map((feature) => ({
      CVE_MUN: feature.properties.CVE_MUN,
      NOM_MUN: feature.properties.NOM_MUN,
      CVE_LOC: feature.properties.CVE_LOC,
      NOM_LOC: feature.properties.NOM_LOC,
      CVEGEO: feature.properties.CVEGEO,
      validadaPor: feature.properties.NOM_LOC === feature.properties.NOM_MUN
        ? "LOC=0001 coincide con NOM_MUN en ITER 2020"
        : "LOC=0001 en ITER 2020; nombre difiere de NOM_MUN, revisar en etapa cartografica",
    }));
  const cabecerasConDiferencia = cabeceras.filter((cabecera) => cabecera.NOM_LOC !== cabecera.NOM_MUN);
  if (cabecerasConDiferencia.length) {
    warnings.push({
      code: "CABECERA_NOMBRE_DIFIERE_DE_MUNICIPIO",
      message: "Algunas localidades LOC=0001 no coinciden literalmente con NOM_MUN.",
      items: cabecerasConDiferencia,
    });
  }
  if (cabeceras.length !== seenMunicipalities.size) {
    warnings.push({
      code: "CABECERAS_NO_COINCIDEN_CON_MUNICIPIOS",
      message: `Se detectaron ${cabeceras.length} cabeceras para ${seenMunicipalities.size} municipios.`,
    });
  }

  const diagnostic = {
    dataset: "Localidades oficiales de Morelos 2020",
    source: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    zipName: ZIP_NAME,
    csvName: path.basename(context.csvPath),
    zipSha256: context.zipSha256,
    processedAtUtc: context.generatedAt,
    encodingDetected: context.encoding,
    sourceFieldsFound: headers,
    sourceFieldsUsed: REQUIRED_FIELDS,
    originalRecords: records.length,
    removedRecords: removed,
    finalRecords: candidates.length,
    localidadesPorTier: countByTier(candidates),
    cabecerasConfirmadas: cabeceras,
    cabecerasCount: cabeceras.length,
    coordinateBounds: coordinateBounds(candidates),
    populationRange: numericRange(candidates.map((feature) => feature.properties.POBTOT)),
    zeroPopulationRecords: candidates
      .filter((feature) => feature.properties.POBTOT === 0)
      .map((feature) => feature.properties.CVEGEO),
    nullAltitudeRecords: candidates
      .filter((feature) => feature.properties.ALTITUD === null)
      .map((feature) => feature.properties.CVEGEO),
    duplicateKeys: [...duplicateKeys.entries()]
      .filter(([, values]) => values.length > 1)
      .map(([CVEGEO, names]) => ({ CVEGEO, names })),
    repeatedNamesWithinMunicipality: [...repeatedByMunicipality.entries()]
      .filter(([, values]) => values.length > 1)
      .map(([key, cvegeos]) => {
        const [CVE_MUN, normalizedName] = key.split("|");
        return { CVE_MUN, normalizedName, cvegeos };
      }),
    repeatedNamesAcrossMunicipalities: [...repeatedAcrossMunicipalities.entries()]
      .filter(([, values]) => new Set(values.map((value) => value.split("|")[0])).size > 1)
      .map(([normalizedName, values]) => ({
        normalizedName,
        occurrences: values.map((value) => {
          const [CVE_MUN, CVEGEO] = value.split("|");
          return { CVE_MUN, CVEGEO };
        }),
      })),
    warnings,
    coordinateConversionMethod:
      "LONGITUD y LATITUD se leen desde ITER en formato DMS; se extraen grados, minutos y segundos, se convierten a decimal con grados + minutos/60 + segundos/3600, y se aplica signo negativo a W.",
    filters:
      "ENTIDAD=17, MUN distinto de 000, LOC distinto de 0000/9998/9999, nombre no vacio, coordenadas DMS validas y bbox razonable de Morelos con margen.",
    validationSummary: validateFeatures(candidates),
  };

  return { features: candidates, diagnostic };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  const headers = rows.shift().map((header) => header.trim());
  const records = rows.filter((values) => values.some((value) => value.trim() !== "")).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    return record;
  });
  return { headers, records };
}

function parseDms(value, expectedHemisphere) {
  const text = clean(value).replace(/""/g, '"');
  if (!text) return null;
  const match = text.match(/(\d{1,3})\D+(\d{1,2})\D+(\d{1,2}(?:\.\d+)?)\D*([NSEW])/i);
  if (!match) return null;
  const [, degreesText, minutesText, secondsText, hemisphereRaw] = match;
  const hemisphere = hemisphereRaw.toUpperCase();
  if (hemisphere !== expectedHemisphere) return null;
  const degrees = Number(degreesText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  const decimal = degrees + minutes / 60 + seconds / 3600;
  return hemisphere === "W" || hemisphere === "S" ? -decimal : decimal;
}

function tierForPopulation(population) {
  if (population >= 50000) return 1;
  if (population >= 25000) return 2;
  if (population >= 5000) return 3;
  if (population >= 1000) return 4;
  return 5;
}

function validateFeatures(features) {
  const priorities = features.map((feature) => feature.properties.labelPriority).sort((a, b) => a - b);
  const cvegeos = features.map((feature) => feature.properties.CVEGEO);
  const tierCounts = countByTier(features);
  return {
    allPoints: features.every((feature) => feature.geometry?.type === "Point"),
    allCoordinatesLonLat: features.every((feature) => {
      const [longitude, latitude] = feature.geometry.coordinates;
      return Number.isFinite(longitude) && Number.isFinite(latitude) && withinBounds(longitude, latitude);
    }),
    uniqueCvegeo: new Set(cvegeos).size === cvegeos.length,
    noNullCoordinates: features.every((feature) => feature.geometry.coordinates.every(Number.isFinite)),
    noEmptyNames: features.every((feature) => feature.properties.NOM_LOC.trim()),
    labelTierRange: features.every((feature) => feature.properties.labelTier >= 1 && feature.properties.labelTier <= 5),
    labelPriorityConsecutive: priorities.every((priority, index) => priority === index + 1),
    tierCountsMatchTotal: Object.values(tierCounts).reduce((sum, value) => sum + value, 0) === features.length,
    noAggregateLocCodes: features.every((feature) => !["0000", "9998", "9999"].includes(feature.properties.CVE_LOC)),
  };
}

function countByTier(features) {
  const counts = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const feature of features) {
    counts[String(feature.properties.labelTier)] += 1;
  }
  return counts;
}

function coordinateBounds(features) {
  const longitudes = features.map((feature) => feature.geometry.coordinates[0]);
  const latitudes = features.map((feature) => feature.geometry.coordinates[1]);
  return {
    minLongitude: Math.min(...longitudes),
    maxLongitude: Math.max(...longitudes),
    minLatitude: Math.min(...latitudes),
    maxLatitude: Math.max(...latitudes),
  };
}

function numericRange(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return {
    min: Math.min(...valid),
    max: Math.max(...valid),
  };
}

function clean(value) {
  return String(value ?? "").trim();
}

function parseInteger(value) {
  const text = clean(value);
  if (!text || text === "*") return null;
  const number = Number.parseInt(text, 10);
  return Number.isFinite(number) ? number : null;
}

function normalizeName(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function roundCoordinate(value) {
  return Number(value.toFixed(8));
}

function withinBounds(longitude, latitude) {
  return (
    longitude >= MORELOS_BOUNDS_WITH_MARGIN.minLon &&
    longitude <= MORELOS_BOUNDS_WITH_MARGIN.maxLon &&
    latitude >= MORELOS_BOUNDS_WITH_MARGIN.minLat &&
    latitude <= MORELOS_BOUNDS_WITH_MARGIN.maxLat
  );
}

function addMapValue(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function detectEncoding(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return "utf8";
  return "utf8";
}

async function downloadFile(url, outputPath) {
  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(new URL(response.headers.location, url).toString(), outputPath).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Descarga fallida ${response.statusCode}: ${url}`));
        return;
      }
      const file = createWriteStream(outputPath);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

function expandZip(zipPath, destination) {
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`No se pudo descomprimir ZIP: ${result.stderr || result.stdout}`);
  }
}

async function findFile(root, predicate) {
  const entries = await readdir(root);
  for (const entry of entries) {
    const entryPath = path.join(root, entry);
    const entryStat = await stat(entryPath);
    if (entryStat.isDirectory()) {
      const found = await findFile(entryPath, predicate).catch(() => null);
      if (found) return found;
    } else if (predicate(entry)) {
      return entryPath;
    }
  }
  throw new Error("Archivo CSV de datos no encontrado.");
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildReadme(diagnostic) {
  return `# Localidades oficiales de Morelos

Este directorio incluye una capa estatica de puntos con localidades oficiales del estado de Morelos, preparada para una etapa posterior de visualizacion progresiva en MapLibre.

## Fuente

- Institucion: INEGI
- Conjunto: Censo de Poblacion y Vivienda 2020, ITER Morelos
- URL oficial: ${SOURCE_URL}
- ZIP: ${ZIP_NAME}
- CSV utilizado: ${diagnostic.csvName}
- SHA-256 del ZIP: \`${diagnostic.zipSha256}\`
- Fecha UTC de generacion: ${diagnostic.processedAtUtc}
- Codificacion detectada: ${diagnostic.encodingDetected}

## Archivos generados

- \`localidades_morelos.geojson\`: FeatureCollection EPSG:4326 con puntos de localidades reales.
- \`localidades_morelos_diagnostico.json\`: resumen reproducible del insumo, filtros, conteos y advertencias.

## Filtros aplicados

Se conservaron registros con \`ENTIDAD=17\`, municipio real, localidad real, nombre valido y coordenadas oficiales validas dentro de un margen razonable alrededor de Morelos. Se excluyeron totales estatales, totales municipales \`LOC=0000\`, agregados \`LOC=9998\` y \`LOC=9999\`, nombres vacios, coordenadas invalidas y coordenadas fuera del margen territorial.

No se eliminaron localidades por poblacion.

## Coordenadas

Los campos \`LONGITUD\` y \`LATITUD\` del ITER vienen en grados, minutos y segundos. La conversion usa:

\`\`\`text
decimal = grados + minutos / 60 + segundos / 3600
\`\`\`

La longitud oeste se conserva como negativa. El orden final GeoJSON es \`[longitud, latitud]\` en WGS 84 / EPSG:4326.

## Clasificacion preparatoria

- \`labelTier=1\`: 50,000 habitantes o mas.
- \`labelTier=2\`: 25,000 a 49,999 habitantes.
- \`labelTier=3\`: 5,000 a 24,999 habitantes.
- \`labelTier=4\`: 1,000 a 4,999 habitantes.
- \`labelTier=5\`: menos de 1,000 habitantes.

Las cabeceras se marcaron con \`esCabecera=true\` cuando \`LOC=0001\`. La prioridad de etiqueta se asigno de forma determinista por mayor poblacion, cabecera antes que no cabecera en empates y \`CVEGEO\` ascendente.

## Regeneracion

Desde la raiz del repositorio:

\`\`\`bash
node scripts/generate-localidades-morelos.mjs
\`\`\`

El script descarga el ZIP oficial a una carpeta temporal fuera del repositorio, calcula el SHA-256, genera los archivos finales y elimina el temporal al terminar.

## Resumen actual

- Registros originales: ${diagnostic.originalRecords}
- Registros finales: ${diagnostic.finalRecords}
- Cabeceras confirmadas: ${diagnostic.cabecerasCount}
- Conteo por tier: ${JSON.stringify(diagnostic.localidadesPorTier)}
`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
