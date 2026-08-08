import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { env } from "../../config/env.js";
import { buildPublicFileUrl } from "../../shared/utils/file-utils.js";

const execFileAsync = promisify(execFile);
const VECTOR_EXTENSIONS = new Set(["geojson", "json", "kml", "kmz", "zip"]);
const GEOJSON_EXTENSIONS = new Set(["geojson", "json"]);
const KMZ_ALLOWED_EXTENSIONS = new Set([
  "",
  "kml",
  "xml",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "xsl",
  "xslt",
  "txt",
  "csv",
  "json",
  "dbf",
  "shp",
  "shx",
  "prj",
  "cpg",
  "sbn",
  "sbx",
]);
const SHAPEFILE_ZIP_ALLOWED_EXTENSIONS = new Set([
  "",
  "shp",
  "shx",
  "dbf",
  "prj",
  "cpg",
  "qix",
  "sbn",
  "sbx",
  "xml",
]);

export async function processUploadedLayer(layer, files) {
  const primaryFile = files?.[0];
  const extension = getExtension(primaryFile?.originalname || primaryFile?.path || layer.sourceType);
  const originalFileNames = (files ?? []).map((file) => file.originalname);

  if (!primaryFile || !VECTOR_EXTENSIONS.has(extension)) {
    return buildProcessingResult({
      status: "pending",
      message: "Formato pendiente de procesamiento para visualizacion.",
      originalFileNames,
    });
  }

  try {
    if (GEOJSON_EXTENSIONS.has(extension)) {
      return await processGeoJson(layer, primaryFile, originalFileNames);
    }

    if (extension === "kml") {
      return await processKml(layer, primaryFile, originalFileNames);
    }

    if (extension === "kmz") {
      return await processKmz(layer, primaryFile, originalFileNames);
    }

    if (extension === "zip") {
      return await processShapefileZip(layer, primaryFile, originalFileNames);
    }
  } catch (error) {
    return buildProcessingResult({
      status: "failed",
      message: error.message,
      originalFileNames,
    });
  }

  return buildProcessingResult({
    status: "pending",
    message: "Formato pendiente de procesamiento para visualizacion.",
    originalFileNames,
  });
}

export async function processGeoJson(layer, file, originalFileNames = []) {
  const raw = fs.readFileSync(file.path, "utf8");
  const geojson = normalizeGeoJson(JSON.parse(raw));
  const outputPath = getProcessedGeoJsonPath(layer.id);

  ensureSafeOutputPath(outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(geojson), "utf8");

  return summarizeProcessedGeoJson(geojson, outputPath, originalFileNames);
}

export function processKml(layer, file, originalFileNames = []) {
  const kmlText = fs.readFileSync(file.path, "utf8");
  const kmlStyleIndex = parseKmlStyleIndex(kmlText);
  return convertWithOgr2Ogr({
    inputPath: file.path,
    outputPath: getProcessedGeoJsonPath(layer.id),
    originalFileNames,
    kmlStyleIndex,
  });
}

export async function processKmz(layer, file, originalFileNames = []) {
  const entries = readZipEntries(file.path);
  validateKmzEntries(entries);
  console.info("KMZ descomprimido correctamente.");
  const kmlEntry = findMainKmlEntry(entries);

  if (!kmlEntry) {
    throw new Error("El KMZ no contiene un archivo KML principal.");
  }

  console.info(`KML principal detectado: ${kmlEntry.name}`);
  const kmlText = readZipEntryText(file.path, kmlEntry);
  const kmlStyleIndex = parseKmlStyleIndex(kmlText);
  console.info("Conversion ogr2ogr iniciada.");
  return convertWithOgr2Ogr({
    inputPath: `/vsizip/${normalizeGdalPath(file.path)}/${kmlEntry.name}`,
    outputPath: getProcessedGeoJsonPath(layer.id),
    originalFileNames,
    kmlStyleIndex,
    logSuccess: "GeoJSON procesado generado.",
  });
}

export async function processShapefileZip(layer, file, originalFileNames = []) {
  const entries = readZipEntries(file.path);
  validateShapefileZipEntries(entries);

  const lowerNames = entries.map((entry) => entry.name.toLowerCase());
  const shpEntry = entries.find((entry) => entry.name.toLowerCase().endsWith(".shp"));
  const hasShx = lowerNames.some((name) => name.endsWith(".shx"));
  const hasDbf = lowerNames.some((name) => name.endsWith(".dbf"));

  if (!shpEntry || !hasShx || !hasDbf) {
    throw new Error("El ZIP de shapefile debe incluir al menos archivos .shp, .shx y .dbf.");
  }

  return convertWithOgr2Ogr({
    inputPath: `/vsizip/${normalizeGdalPath(file.path)}/${shpEntry.name}`,
    outputPath: getProcessedGeoJsonPath(layer.id),
    originalFileNames,
  });
}

export async function convertWithOgr2Ogr({ inputPath, outputPath, originalFileNames = [], logSuccess = null, kmlStyleIndex = null }) {
  const hasOgr = await hasOgr2Ogr();
  if (!hasOgr) {
    return buildProcessingResult({
      status: "pending",
      message: "La capa fue cargada, pero requiere procesamiento GDAL para visualizacion.",
      originalFileNames,
    });
  }

  ensureSafeOutputPath(outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (fs.existsSync(outputPath)) {
    fs.rmSync(outputPath, { force: true });
  }

  try {
    await execFileAsync("ogr2ogr", [
      "-f",
      "GeoJSON",
      "-t_srs",
      "EPSG:4326",
      outputPath,
      inputPath,
    ]);
  } catch (error) {
    throw new Error(`No se pudo convertir la capa con GDAL/ogr2ogr: ${error.message}`);
  }

  const raw = fs.readFileSync(outputPath, "utf8");
  const geojson = enrichGeoJsonWithKmlStyles(normalizeGeoJson(JSON.parse(raw)), kmlStyleIndex);
  fs.writeFileSync(outputPath, JSON.stringify(geojson), "utf8");
  if (logSuccess) {
    console.info(logSuccess);
  }
  return summarizeProcessedGeoJson(geojson, outputPath, originalFileNames);
}

function normalizeGeoJson(value) {
  if (value?.type === "FeatureCollection") {
    return {
      ...value,
      features: Array.isArray(value.features) ? value.features : [],
    };
  }

  if (value?.type === "Feature") {
    return {
      type: "FeatureCollection",
      features: [value],
    };
  }

  throw new Error("El archivo GeoJSON debe ser FeatureCollection o Feature.");
}

function summarizeProcessedGeoJson(geojson, outputPath, originalFileNames) {
  const geometryTypes = new Set();
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];

  for (const feature of geojson.features) {
    if (feature.geometry?.type) {
      geometryTypes.add(feature.geometry.type);
    }
    collectGeometryBbox(feature.geometry, bbox);
  }

  const hasBbox = bbox.every(Number.isFinite);

  return buildProcessingResult({
    status: "processed",
    processedGeojsonPath: outputPath,
    processedGeojsonUrl: buildPublicFileUrl(env.PUBLIC_BASE_URL, outputPath),
    geometryType: geometryTypes.size ? [...geometryTypes].join(", ") : "Vector GeoJSON",
    featureCount: geojson.features.length,
    bbox: hasBbox ? bbox : null,
    crs: "EPSG:4326",
    originalFileNames,
  });
}

function collectGeometryBbox(geometry, bbox) {
  if (!geometry) return;

  if (geometry.type === "GeometryCollection") {
    for (const item of geometry.geometries ?? []) {
      collectGeometryBbox(item, bbox);
    }
    return;
  }

  visitCoordinates(geometry.coordinates, (coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return;
    const [x, y] = coordinate;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    bbox[0] = Math.min(bbox[0], x);
    bbox[1] = Math.min(bbox[1], y);
    bbox[2] = Math.max(bbox[2], x);
    bbox[3] = Math.max(bbox[3], y);
  });
}

function visitCoordinates(value, visitor) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number") {
    visitor(value);
    return;
  }
  for (const item of value) {
    visitCoordinates(item, visitor);
  }
}

function readZipEntries(filePath) {
  const buffer = fs.readFileSync(filePath);
  const entries = [];
  let offset = 0;

  while (offset < buffer.length - 46) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      offset += 1;
      continue;
    }

    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8").replace(/\\/g, "/");
    entries.push({ name, compressedSize, uncompressedSize, compressionMethod, localHeaderOffset });
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function readZipEntryText(filePath, entry) {
  const buffer = fs.readFileSync(filePath);
  const offset = entry.localHeaderOffset;

  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`No se pudo leer la entrada KMZ: ${entry.name}`);
  }

  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return compressed.toString("utf8");
  }

  if (entry.compressionMethod === 8) {
    return zlib.inflateRawSync(compressed).toString("utf8");
  }

  throw new Error(`Metodo de compresion KMZ no soportado para ${entry.name}.`);
}

function parseKmlStyleIndex(kmlText) {
  const styles = readKmlStyles(kmlText);
  const styleMaps = readKmlStyleMaps(kmlText, styles);
  const mergedStyles = new Map([...styles, ...styleMaps]);
  const placemarks = readKmlPlacemarks(kmlText, mergedStyles);

  console.info("Estilos KML detectados:", styles.size);
  console.info("StyleMap detectado:", styleMaps.size);

  return {
    styles: mergedStyles,
    placemarks,
    byName: new Map(placemarks.filter((item) => item.name).map((item) => [item.name, item.style])),
    byStyleUrl: new Map(placemarks.filter((item) => item.styleUrl).map((item) => [item.styleUrl, item.style])),
  };
}

function readKmlStyles(kmlText) {
  const styles = new Map();
  const styleRegex = /<Style\b([^>]*)>([\s\S]*?)<\/Style>/gi;
  let match = null;

  while ((match = styleRegex.exec(kmlText))) {
    const id = readXmlAttribute(match[1], "id");
    if (!id) continue;
    styles.set(`#${id}`, extractKmlStyle(match[2]));
  }

  return styles;
}

function readKmlStyleMaps(kmlText, styles) {
  const styleMaps = new Map();
  const styleMapRegex = /<StyleMap\b([^>]*)>([\s\S]*?)<\/StyleMap>/gi;
  let match = null;

  while ((match = styleMapRegex.exec(kmlText))) {
    const id = readXmlAttribute(match[1], "id");
    if (!id) continue;

    const normalPair = [...match[2].matchAll(/<Pair\b[^>]*>([\s\S]*?)<\/Pair>/gi)].find((pair) => {
      return readXmlTag(pair[1], "key") === "normal";
    });
    const styleUrl = normalPair ? readXmlTag(normalPair[1], "styleUrl") : null;
    if (styleUrl && styles.has(styleUrl)) {
      styleMaps.set(`#${id}`, styles.get(styleUrl));
    }
  }

  return styleMaps;
}

function readKmlPlacemarks(kmlText, styles) {
  const placemarks = [];
  const placemarkRegex = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let match = null;

  while ((match = placemarkRegex.exec(kmlText))) {
    const body = match[1];
    const name = decodeXmlText(readXmlTag(body, "name"));
    const styleUrl = readXmlTag(body, "styleUrl");
    const inlineStyle = extractFirstInlineKmlStyle(body);
    const linkedStyle = styleUrl ? styles.get(styleUrl) || null : null;
    const style = mergeKmlStyles(linkedStyle, inlineStyle);

    if (styleUrl) {
      console.info("Placemark con styleUrl:", styleUrl);
    }

    placemarks.push({ name, styleUrl, style });
  }

  return placemarks;
}

function extractFirstInlineKmlStyle(value) {
  const match = value.match(/<Style\b[^>]*>([\s\S]*?)<\/Style>/i);
  return match ? extractKmlStyle(match[1]) : null;
}

function extractKmlStyle(styleBody) {
  const polyStyle = readXmlTagBody(styleBody, "PolyStyle");
  const lineStyle = readXmlTagBody(styleBody, "LineStyle");
  const fill = polyStyle ? parseKmlColor(readXmlTag(polyStyle, "color")) : null;
  const stroke = lineStyle ? parseKmlColor(readXmlTag(lineStyle, "color")) : null;

  return {
    fill: fill?.hex || null,
    stroke: stroke?.hex || null,
    opacity: fill?.opacity ?? stroke?.opacity ?? null,
  };
}

function mergeKmlStyles(linkedStyle, inlineStyle) {
  if (!linkedStyle && !inlineStyle) return null;
  return {
    ...(linkedStyle || {}),
    ...(inlineStyle || {}),
  };
}

function enrichGeoJsonWithKmlStyles(geojson, kmlStyleIndex) {
  if (!kmlStyleIndex?.placemarks?.length) return geojson;

  return {
    ...geojson,
    features: geojson.features.map((feature, index) => {
      const properties = feature.properties || {};
      const style = resolveFeatureKmlStyle(properties, index, kmlStyleIndex);
      if (!style?.fill && !style?.stroke) return feature;

      const enrichedProperties = {
        ...properties,
        ...(style.fill ? { __styleFill: style.fill } : {}),
        ...(style.stroke ? { __styleStroke: style.stroke, __styleLine: style.stroke } : {}),
        ...(style.opacity !== null && style.opacity !== undefined ? { __styleOpacity: style.opacity } : {}),
      };

      if (style.fill) {
        console.info("__styleFill aplicado:", style.fill);
      }

      return {
        ...feature,
        properties: enrichedProperties,
      };
    }),
  };
}

function resolveFeatureKmlStyle(properties, index, kmlStyleIndex) {
  const styleUrl = properties.styleUrl || properties.StyleUrl || properties.styleurl;
  if (styleUrl && kmlStyleIndex.byStyleUrl.has(styleUrl)) {
    return kmlStyleIndex.byStyleUrl.get(styleUrl);
  }

  const name = properties.Name || properties.name || properties.NAME;
  if (name && kmlStyleIndex.byName.has(name)) {
    return kmlStyleIndex.byName.get(name);
  }

  return kmlStyleIndex.placemarks[index]?.style || null;
}

function parseKmlColor(value) {
  const cleaned = String(value || "").trim().replace("#", "");
  if (!/^[0-9a-f]{8}$/i.test(cleaned)) return null;

  const alpha = parseInt(cleaned.slice(0, 2), 16) / 255;
  const blue = cleaned.slice(2, 4);
  const green = cleaned.slice(4, 6);
  const red = cleaned.slice(6, 8);

  return {
    hex: `#${red}${green}${blue}`.toLowerCase(),
    opacity: Number(alpha.toFixed(3)),
  };
}

function readXmlAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match ? match[1].trim() : "";
}

function readXmlTag(value, tagName) {
  const body = readXmlTagBody(value, tagName);
  return body ? decodeXmlText(body.replace(/<[^>]*>/g, "").trim()) : "";
}

function readXmlTagBody(value, tagName) {
  const match = value.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1].trim() : "";
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function validateArchiveEntries(entries, allowedExtensions) {
  if (!entries.length) {
    throw new Error("El archivo comprimido no contiene entradas legibles.");
  }

  for (const entry of entries) {
    if (isUnsafeArchivePath(entry.name)) {
      throw new Error(`El archivo comprimido contiene una ruta no segura: ${entry.name}`);
    }
    if (isDirectoryEntry(entry.name)) {
      continue;
    }
    const extension = getExtension(entry.name);
    if (!allowedExtensions.has(extension)) {
      throw new Error(`El archivo comprimido contiene un archivo no permitido: ${entry.name}`);
    }
  }
}

function validateKmzEntries(entries) {
  validateArchiveEntries(entries, KMZ_ALLOWED_EXTENSIONS);
}

function validateShapefileZipEntries(entries) {
  validateArchiveEntries(entries, SHAPEFILE_ZIP_ALLOWED_EXTENSIONS);
}

function findMainKmlEntry(entries) {
  const kmlEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith(".kml"));
  return (
    kmlEntries.find((entry) => path.basename(entry.name).toLowerCase() === "doc.kml") ||
    kmlEntries[0] ||
    null
  );
}

function isDirectoryEntry(value) {
  return value.endsWith("/");
}

function isUnsafeArchivePath(value) {
  return (
    !value ||
    path.isAbsolute(value) ||
    value.includes("..") ||
    value.includes(":") ||
    value.startsWith("/") ||
    value.startsWith("\\")
  );
}

async function hasOgr2Ogr() {
  try {
    await execFileAsync("ogr2ogr", ["--version"]);
    return true;
  } catch (_error) {
    return false;
  }
}

function getProcessedGeoJsonPath(layerId) {
  return path.join(env.UPLOAD_BASE_DIR, "processed", layerId, "layer.geojson");
}

function ensureSafeOutputPath(outputPath) {
  const uploadRoot = path.resolve(env.UPLOAD_BASE_DIR);
  const resolvedOutput = path.resolve(outputPath);
  if (!resolvedOutput.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error("Ruta de salida procesada no permitida.");
  }
}

function normalizeGdalPath(filePath) {
  return path.resolve(filePath).replace(/\\/g, "/");
}

function getExtension(filename) {
  return path.extname(filename).replace(".", "").toLowerCase();
}

function buildProcessingResult({
  status,
  message = null,
  processedGeojsonPath = null,
  processedGeojsonUrl = null,
  geometryType = null,
  featureCount = null,
  bbox = null,
  crs = null,
  originalFileNames = [],
}) {
  return {
    processingStatus: status,
    processingMessage: message,
    processedGeojsonPath,
    processedGeojsonUrl,
    isVisualizable: status === "processed" && Boolean(processedGeojsonPath),
    geometryType,
    featureCount,
    bbox,
    crs,
    originalFileNames,
  };
}
