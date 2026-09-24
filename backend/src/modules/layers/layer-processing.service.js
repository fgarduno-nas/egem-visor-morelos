import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import zlib from "node:zlib";

import { env } from "../../config/env.js";
import { buildPublicFileUrl } from "../../shared/utils/file-utils.js";
import {
  analyzeKmlText,
  analyzeKmzFile,
  extractGroundOverlayImages,
  inferGeometryRole,
  readFolderAwareLegendPlacemarks,
  readZipEntries,
  readZipEntryBuffer,
  readZipEntryText,
  validateArchiveEntries as validateArchiveEntriesSecurity,
} from "./geospatial-importer.service.js";
import { detectRasterLegendForGroundOverlays } from "./raster-legend-detector.service.js";

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
  "webp",
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
  const analysis = analyzeKmlText(kmlText, { sourceName: file.originalname || file.path });
  const kmlStyleIndex = parseKmlStyleIndex(kmlText);

  if (!analysis.vector.geometryCount && analysis.groundOverlays.length) {
    throw new Error("El KML contiene GroundOverlay, pero la imagen debe venir dentro de un KMZ seguro para poder publicarse.");
  }

  return convertWithOgr2Ogr({
    inputPath: file.path,
    outputPath: getProcessedGeoJsonPath(layer.id),
    originalFileNames,
    kmlStyleIndex,
    diagnostics: analysis,
    vectorLegend: analysis.vectorLegend,
    extractedMetadata: analysis.extractedMetadata,
    singleLayerName: "layer",
  });
}

export async function processKmz(layer, file, originalFileNames = []) {
  const analysis = analyzeKmzFile(file.path);
  const entries = analysis.entries;
  validateKmzEntries(entries);
  console.info("KMZ descomprimido correctamente.");
  const kmlEntry = analysis.kmlEntry;

  if (!kmlEntry) {
    throw new Error("El KMZ no contiene un archivo KML principal.");
  }

  console.info(`KML principal detectado: ${kmlEntry.name}`);
  const kmlText = analysis.kmlText || readZipEntryText(file.path, kmlEntry);
  const kmlStyleIndex = parseKmlStyleIndex(kmlText);
  enrichKmlStyleIndexWithKmzIconColors(kmlStyleIndex, {
    archivePath: file.path,
    entries,
    kmlEntryName: kmlEntry.name,
  });
  const pointIcons = extractKmzPointIconAssets({
    archivePath: file.path,
    layerId: layer.id,
    entries,
    kmlEntryName: kmlEntry.name,
    kmlStyleIndex,
    vectorLegend: analysis.diagnostics?.vectorLegend,
  });
  const validOverlays = analysis.groundOverlays.filter((overlay) => overlay.isValid && overlay.imageEntry);
  const groundOverlays = validOverlays.length
    ? extractGroundOverlayImages({
        archivePath: file.path,
        layerId: layer.id,
        overlays: validOverlays,
        outputRoot: env.UPLOAD_BASE_DIR,
        publicBaseUrl: env.PUBLIC_BASE_URL,
      })
    : [];
  const rasterLegendDetection = groundOverlays.length
    ? await detectRasterLegendForGroundOverlays(groundOverlays, {
        title: layer.title,
        name: layer.title,
        fileName: file.originalname,
        metadata: layer.metadata?.properties,
      })
    : { rasterLegend: null, diagnostics: null };
  if (rasterLegendDetection.diagnostics) {
    console.info("Deteccion de leyenda raster:", {
      confidence: rasterLegendDetection.diagnostics.confidence,
      profile: rasterLegendDetection.diagnostics.profile,
      concept: rasterLegendDetection.diagnostics.concept?.concept || null,
      timingsMs: rasterLegendDetection.diagnostics.timingsMs,
    });
  }

  if (!analysis.vector.geometryCount && groundOverlays.length) {
    console.info("GroundOverlay detectado y procesado:", groundOverlays.length);
    return buildProcessingResult({
      status: "processed",
      message: "Capa raster georreferenciada (GroundOverlay) procesada correctamente.",
      resourceType: "ground-overlay",
      geometryType: "GroundOverlay raster",
      featureCount: 0,
      bbox: analysis.bbox,
      crs: "EPSG:4326",
      originalFileNames,
      groundOverlays,
      rasterLegend: rasterLegendDetection.rasterLegend,
      rasterLegendDiagnostics: rasterLegendDetection.diagnostics,
      pointIcons,
      diagnostics: analysis.diagnostics,
    });
  }

  if (!analysis.vector.geometryCount && !groundOverlays.length) {
    const detail = analysis.diagnostics?.errors?.length ? ` ${analysis.diagnostics.errors.join(" ")}` : "";
    throw new Error(`El archivo no contiene geometria vectorial ni una imagen georreferenciada valida.${detail}`);
  }

  console.info("Conversion ogr2ogr iniciada.");
  const vectorResult = await convertWithOgr2Ogr({
    inputPath: `/vsizip/${normalizeGdalPath(file.path)}/${kmlEntry.name}`,
    outputPath: getProcessedGeoJsonPath(layer.id),
    originalFileNames,
    kmlStyleIndex,
    logSuccess: "GeoJSON procesado generado.",
    diagnostics: analysis.diagnostics,
    vectorLegend: analysis.diagnostics?.vectorLegend,
    extractedMetadata: analysis.diagnostics?.extractedMetadata,
    pointIcons,
    singleLayerName: "layer",
  });

  if (!groundOverlays.length) return vectorResult;

  return buildProcessingResult({
    ...vectorResult,
    status: "processed",
    message: "Capa mixta con geometria vectorial y GroundOverlay procesada correctamente.",
    resourceType: "mixed",
    geometryType: `${vectorResult.geometryType || "Vector KML"} + GroundOverlay raster`,
    bbox: mergeProcessingBboxes(vectorResult.bbox, analysis.bbox),
    groundOverlays,
    rasterLegend: rasterLegendDetection.rasterLegend,
    rasterLegendDiagnostics: rasterLegendDetection.diagnostics,
    pointIcons,
    diagnostics: analysis.diagnostics,
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

export async function convertWithOgr2Ogr({
  inputPath,
  outputPath,
  originalFileNames = [],
  logSuccess = null,
  kmlStyleIndex = null,
  diagnostics = null,
  vectorLegend = null,
  extractedMetadata = null,
  pointIcons = [],
  singleLayerName = null,
}) {
  const hasOgr = await hasOgr2Ogr();
  if (!hasOgr) {
    return buildProcessingResult({
      status: "pending",
      message: "La capa fue cargada, pero requiere procesamiento GDAL para visualizacion.",
      originalFileNames,
      diagnostics,
      vectorLegend,
      extractedMetadata,
      pointIcons,
    });
  }

  ensureSafeOutputPath(outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (fs.existsSync(outputPath)) {
    fs.rmSync(outputPath, { force: true });
  }

  try {
    const args = [
      "-f",
      "GeoJSON",
      "-t_srs",
      "EPSG:4326",
      outputPath,
      inputPath,
    ];
    if (singleLayerName) {
      args.push("-nln", singleLayerName);
    }
    await execFileAsync("ogr2ogr", args);
  } catch (error) {
    throw new Error(`No se pudo convertir la capa con GDAL/ogr2ogr: ${error.message}`);
  }

  const raw = fs.readFileSync(outputPath, "utf8");
  const geojson = enrichGeoJsonWithKmlStyles(normalizeGeoJson(JSON.parse(raw)), kmlStyleIndex);
  fs.writeFileSync(outputPath, JSON.stringify(geojson), "utf8");
  if (logSuccess) {
    console.info(logSuccess);
  }
  return summarizeProcessedGeoJson(geojson, outputPath, originalFileNames, diagnostics, { vectorLegend, extractedMetadata, pointIcons });
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

function summarizeProcessedGeoJson(geojson, outputPath, originalFileNames, diagnostics = null, options = {}) {
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
    resourceType: "vector",
    processedGeojsonPath: outputPath,
    processedGeojsonUrl: buildPublicFileUrl(env.PUBLIC_BASE_URL, outputPath),
    geometryType: geometryTypes.size ? [...geometryTypes].join(", ") : "Vector GeoJSON",
    featureCount: geojson.features.length,
    bbox: hasBbox ? bbox : null,
    crs: "EPSG:4326",
    originalFileNames,
    diagnostics,
    vectorLegend: options.vectorLegend || diagnostics?.vectorLegend || null,
    vectorSublayers: options.vectorSublayers || diagnostics?.vectorSublayers || null,
    extractedMetadata: options.extractedMetadata || diagnostics?.extractedMetadata || null,
    pointIcons: options.pointIcons || [],
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

export function parseKmlStyleIndex(kmlText) {
  const styles = readKmlStyles(kmlText);
  const styleMaps = readKmlStyleMaps(kmlText, styles);
  const mergedStyles = new Map([...styles, ...styleMaps]);
  const placemarks = readKmlPlacemarks(kmlText, mergedStyles);

  console.info("Estilos KML detectados:", styles.size);
  console.info("StyleMap detectado:", styleMaps.size);

  return {
    styles: mergedStyles,
    placemarks,
    byName: buildUniquePlacemarkStyleIndex(placemarks),
    byStyleUrl: new Map(placemarks.filter((item) => item.styleUrl).map((item) => [item.styleUrl, item.style])),
  };
}

function buildUniquePlacemarkStyleIndex(placemarks) {
  const grouped = new Map();
  placemarks.forEach((item) => {
    if (!item.name || !item.style) return;
    if (!grouped.has(item.name)) grouped.set(item.name, []);
    grouped.get(item.name).push(item.style);
  });

  return new Map(
    [...grouped.entries()]
      .filter(([_name, styles]) => styles.length === 1)
      .map(([name, styles]) => [name, styles[0]])
  );
}

function readKmlStyles(kmlText) {
  const styles = new Map();
  const styleRegex = /<Style\b([^>]*)>([\s\S]*?)<\/Style>/gi;
  let match = null;

  while ((match = styleRegex.exec(kmlText))) {
    const id = readXmlAttribute(match[1], "id");
    if (!id) continue;
    styles.set(`#${id}`, { id, ...extractKmlStyle(match[2]) });
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
      styleMaps.set(`#${id}`, { ...styles.get(styleUrl), id });
    }
  }

  return styleMaps;
}

function readKmlPlacemarks(kmlText, styles) {
  return readFolderAwareLegendPlacemarks(kmlText).map((placemark) => {
    const styleUrl = placemark.styleUrl;
    const inlineStyle = null;
    const linkedStyle = styleUrl ? styles.get(styleUrl) || null : null;
    const style = mergeKmlStyles(linkedStyle, inlineStyle);

    if (styleUrl) {
      console.info("Placemark con styleUrl:", styleUrl);
    }

    return {
      name: placemark.name,
      folder: placemark.folder,
      styleUrl,
      styleId: placemark.styleId,
      geometryType: placemark.geometryType,
      geometryRole: placemark.geometryRole,
      legendField: getKmlLegendFieldForPlacemark(placemark),
      style,
    };
  });
}

function extractFirstInlineKmlStyle(value) {
  const match = value.match(/<Style\b[^>]*>([\s\S]*?)<\/Style>/i);
  return match ? extractKmlStyle(match[1]) : null;
}

function extractKmlStyle(styleBody) {
  const polyStyle = readXmlTagBody(styleBody, "PolyStyle");
  const lineStyle = readXmlTagBody(styleBody, "LineStyle");
  const iconStyle = readXmlTagBody(styleBody, "IconStyle");
  const fill = polyStyle ? parseKmlColor(readXmlTag(polyStyle, "color")) : null;
  const stroke = lineStyle ? parseKmlColor(readXmlTag(lineStyle, "color")) : null;
  const icon = iconStyle ? parseKmlColor(readXmlTag(iconStyle, "color")) : null;
  const scale = iconStyle ? toFiniteNumber(readXmlTag(iconStyle, "scale")) : null;

  return {
    fill: fill?.hex || null,
    stroke: stroke?.hex || null,
    icon: icon?.opacity > 0 ? icon.hex : null,
    iconHref: iconStyle ? readXmlTag(readXmlTagBody(iconStyle, "Icon"), "href") || null : null,
    scale,
    opacity: fill?.opacity ?? stroke?.opacity ?? icon?.opacity ?? null,
  };
}

function mergeKmlStyles(linkedStyle, inlineStyle) {
  if (!linkedStyle && !inlineStyle) return null;
  return {
    ...(linkedStyle || {}),
    ...(inlineStyle || {}),
  };
}

export function enrichGeoJsonWithKmlStyles(geojson, kmlStyleIndex) {
  if (!kmlStyleIndex?.placemarks?.length) return geojson;

  return {
    ...geojson,
    features: geojson.features.map((feature, index) => {
      const properties = feature.properties || {};
      const placemark = kmlStyleIndex.placemarks[index] || {};
      const style = resolveFeatureKmlStyle(properties, index, kmlStyleIndex);
      const hasStyle = Boolean(style?.fill || style?.stroke || style?.icon);
      if (!hasStyle && !placemark.folder && !placemark.geometryRole && !placemark.styleId) return feature;
      const isPointGeometry = ["Point", "MultiPoint"].includes(feature.geometry?.type);
      const geometryRole = placemark.geometryRole || inferGeometryRole(placemark.folder, feature.geometry?.type);

      const enrichedProperties = {
        ...properties,
        ...(placemark.folder ? { __kmlFolder: placemark.folder } : {}),
        ...(placemark.styleId ? { __kmlStyleId: placemark.styleId } : {}),
        ...(geometryRole ? { __geometryRole: geometryRole } : {}),
        ...(placemark.legendField ? { __legendField: placemark.legendField } : {}),
        ...(style.fill && !isPointGeometry ? { __styleFill: style.fill } : {}),
        ...(style.stroke ? { __styleStroke: style.stroke, __styleLine: style.stroke } : {}),
        ...(style.icon ? { __styleIcon: style.icon } : {}),
        ...(style.opacity !== null && style.opacity !== undefined ? { __styleOpacity: style.opacity } : {}),
      };

      if (style.fill && !isPointGeometry) {
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

  const indexedStyle = kmlStyleIndex.placemarks[index]?.style || null;
  if (indexedStyle?.fill || indexedStyle?.stroke || indexedStyle?.icon) return indexedStyle;

  const name = properties.Name || properties.name || properties.NAME;
  if (name && kmlStyleIndex.byName.has(name)) {
    return kmlStyleIndex.byName.get(name);
  }

  return null;
}

export function enrichKmlStyleIndexWithKmzIconColors(kmlStyleIndex, { archivePath, entries, kmlEntryName }) {
  if (!kmlStyleIndex?.styles?.size || !Array.isArray(entries)) return kmlStyleIndex;

  const styleObjects = new Set([
    ...kmlStyleIndex.styles.values(),
    ...(kmlStyleIndex.placemarks || []).map((placemark) => placemark.style).filter(Boolean),
  ]);

  for (const style of styleObjects) {
    if (!style?.iconHref || style.icon) continue;
    const entry = resolveKmzRelativeEntry(entries, kmlEntryName, style.iconHref);
    if (!entry || getExtension(entry.name) !== "png") continue;
    const iconColor = detectDominantPngIconColor(readZipEntryBuffer(archivePath, entry));
    if (iconColor) {
      style.icon = iconColor;
    }
  }

  return kmlStyleIndex;
}

function getKmlLegendFieldForPlacemark(placemark) {
  const attributes = placemark?.attributes || {};
  if (placemark?.geometryRole === "descargas-sin-tratamientos" && isUsableKmlAttribute(attributes.Intensidad)) return "Intensidad";
  return null;
}

function isUsableKmlAttribute(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function extractKmzPointIconAssets({ archivePath, layerId, entries, kmlEntryName, kmlStyleIndex, vectorLegend }) {
  if (!kmlStyleIndex?.styles?.size || !Array.isArray(entries)) return [];
  const outputDir = path.join(env.UPLOAD_BASE_DIR, "processed", layerId, "point-icons");
  const iconsByHref = new Map();
  const styles = [...kmlStyleIndex.styles.entries()]
    .map(([styleUrl, style]) => ({ styleUrl, style }))
    .filter((item) => item.style?.iconHref);
  const legendClasses = Array.isArray(vectorLegend?.classes) ? vectorLegend.classes : [];

  for (const { styleUrl, style } of styles) {
    const entry = resolveKmzRelativeEntry(entries, kmlEntryName, style.iconHref);
    if (!entry || getExtension(entry.name) !== "png") continue;
    const normalizedEntryName = normalizeArchivePath(entry.name);
    const buffer = readZipEntryBuffer(archivePath, entry);
    const decoded = decodeSimplePng(buffer, { maxWidth: 512, maxHeight: 512, maxBytes: 1024 * 1024 });
    if (!decoded) continue;

    let icon = iconsByHref.get(normalizedEntryName);
    if (!icon) {
      const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
      const safeBaseName = path.basename(normalizedEntryName).replace(/[^a-z0-9_.-]+/gi, "_") || "icon.png";
      const outputPath = path.join(outputDir, `${hash}-${safeBaseName}`);
      ensureSafeOutputPath(outputPath);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, buffer);
      icon = {
        id: hash,
        href: style.iconHref,
        sourceEntry: normalizedEntryName,
        imagePath: outputPath,
        imageUrl: buildPublicFileUrl(env.PUBLIC_BASE_URL, outputPath),
        mimeType: "image/png",
        width: decoded.width,
        height: decoded.height,
        styles: [],
      };
      iconsByHref.set(normalizedEntryName, icon);
    }

    const matchingClass = legendClasses.find((item) => item.styleUrl === styleUrl || item.iconHref === style.iconHref);
    icon.styles.push({
      styleUrl,
      styleId: String(styleUrl || "").replace(/^#/u, "") || style.id || null,
      label: matchingClass?.label || null,
      value: matchingClass?.value ?? matchingClass?.label ?? null,
      color: style.icon || matchingClass?.color || null,
      scale: style.scale ?? null,
    });
  }

  return [...iconsByHref.values()].flatMap((icon) => {
    const styles = icon.styles.length ? icon.styles : [{ styleUrl: null, label: null, value: null, color: null }];
    return styles.map((style, index) => ({
      ...icon,
      id: `${icon.id}-${index + 1}`,
      styles: undefined,
      styleUrl: style.styleUrl,
      styleId: style.styleId,
      label: style.label,
      value: style.value,
      color: style.color,
      scale: style.scale,
    }));
  });
}

function resolveKmzRelativeEntry(entries, kmlEntryName, href) {
  const normalizedHref = normalizeArchivePath(href);
  if (!normalizedHref || isExternalUrl(normalizedHref) || isUnsafeArchivePath(normalizedHref)) return null;

  const kmlDir = path.posix.dirname(normalizeArchivePath(kmlEntryName));
  const candidates = [
    normalizedHref,
    kmlDir && kmlDir !== "." ? path.posix.normalize(`${kmlDir}/${normalizedHref}`) : normalizedHref,
  ];
  const candidateSet = new Set(candidates.map((item) => item.toLowerCase()));
  return entries.find((entry) => candidateSet.has(normalizeArchivePath(entry.name).toLowerCase())) || null;
}

function normalizeArchivePath(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/u, "");
}

function isExternalUrl(value) {
  return /^[a-z][a-z0-9+.-]*:/iu.test(String(value || ""));
}

function detectDominantPngIconColor(buffer) {
  let png;
  try {
    png = decodeSimplePng(buffer, { maxWidth: 512, maxHeight: 512, maxBytes: 1024 * 1024 });
  } catch (_error) {
    return null;
  }
  if (!png) return null;

  const colors = new Map();
  for (const pixel of png.pixels) {
    if (pixel.a < 16) continue;
    const key = `#${toHexByte(pixel.r)}${toHexByte(pixel.g)}${toHexByte(pixel.b)}`;
    colors.set(key, (colors.get(key) || 0) + 1);
  }
  return [...colors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function decodeSimplePng(buffer, limits) {
  if (!Buffer.isBuffer(buffer) || buffer.length > limits.maxBytes) return null;
  if (buffer.length < 33 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;

  let offset = 8;
  let header = null;
  const idatChunks = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) return null;
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (data.length < 13) return null;
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!header || !idatChunks.length) return null;
  if (header.width < 1 || header.height < 1 || header.width > limits.maxWidth || header.height > limits.maxHeight) return null;
  if (header.bitDepth !== 8 || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) return null;
  const bytesPerPixel = header.colorType === 6 ? 4 : header.colorType === 2 ? 3 : null;
  if (!bytesPerPixel) return null;

  const inflated = Buffer.concat(idatChunks);
  let raw;
  try {
    raw = zlib.inflateSync(inflated);
  } catch (_error) {
    return null;
  }
  const stride = header.width * bytesPerPixel;
  const expectedSize = (stride + 1) * header.height;
  if (raw.length < expectedSize) return null;

  const pixels = [];
  let rawOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    if (filter > 4) return null;
    const scanline = Buffer.from(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;
    unfilterPngScanline(scanline, previous, filter, bytesPerPixel);
    for (let x = 0; x < header.width; x += 1) {
      const index = x * bytesPerPixel;
      pixels.push({
        r: scanline[index],
        g: scanline[index + 1],
        b: scanline[index + 2],
        a: bytesPerPixel === 4 ? scanline[index + 3] : 255,
      });
    }
    previous = scanline;
  }

  return { width: header.width, height: header.height, pixels };
}

function unfilterPngScanline(scanline, previous, filter, bytesPerPixel) {
  for (let index = 0; index < scanline.length; index += 1) {
    const left = index >= bytesPerPixel ? scanline[index - bytesPerPixel] : 0;
    const up = previous[index] || 0;
    const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] || 0 : 0;
    if (filter === 1) scanline[index] = (scanline[index] + left) & 0xff;
    if (filter === 2) scanline[index] = (scanline[index] + up) & 0xff;
    if (filter === 3) scanline[index] = (scanline[index] + Math.floor((left + up) / 2)) & 0xff;
    if (filter === 4) scanline[index] = (scanline[index] + paethPredictor(left, up, upperLeft)) & 0xff;
  }
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function toHexByte(value) {
  return value.toString(16).padStart(2, "0");
}

function toFiniteNumber(value) {
  const number = Number(String(value || "").trim());
  return Number.isFinite(number) ? number : null;
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
  validateArchiveEntriesSecurity(entries);
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
  resourceType = "vector",
  processedGeojsonPath = null,
  processedGeojsonUrl = null,
  geometryType = null,
  featureCount = null,
  bbox = null,
  crs = null,
  originalFileNames = [],
  groundOverlays = [],
  rasterLegend = null,
  rasterLegendDiagnostics = null,
  vectorLegend = null,
  vectorSublayers = null,
  extractedMetadata = null,
  pointIcons = [],
  diagnostics = null,
}) {
  return {
    processingStatus: status,
    processingMessage: message,
    resourceType,
    processedGeojsonPath,
    processedGeojsonUrl,
    groundOverlays,
    isVisualizable: status === "processed" && (Boolean(processedGeojsonPath) || groundOverlays.length > 0),
    geometryType,
    featureCount,
    bbox,
    crs,
    originalFileNames,
    rasterLegend,
    rasterLegendDiagnostics,
    vectorLegend,
    vectorSublayers,
    extractedMetadata,
    pointIcons,
    diagnostics,
  };
}

function mergeProcessingBboxes(primary, secondary) {
  const boxes = [primary, secondary].filter((bbox) => Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite));
  if (!boxes.length) return null;
  return boxes.reduce(
    (acc, bbox) => [
      Math.min(acc[0], bbox[0]),
      Math.min(acc[1], bbox[1]),
      Math.max(acc[2], bbox[2]),
      Math.max(acc[3], bbox[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity]
  );
}
