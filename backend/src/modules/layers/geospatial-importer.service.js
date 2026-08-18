import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const IMPORT_LIMITS = {
  maxArchiveEntries: 250,
  maxCompressedBytes: 120 * 1024 * 1024,
  maxUncompressedBytes: 450 * 1024 * 1024,
  maxSingleEntryBytes: 120 * 1024 * 1024,
};

export const GROUND_OVERLAY_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

const KML_VECTOR_TAGS = [
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "MultiGeometry",
  "GeometryCollection",
];

export function analyzeKmlText(kmlText, options = {}) {
  const sourceName = options.sourceName || "archivo.kml";
  const vectorSummary = analyzeKmlVectorContent(kmlText);
  const overlays = parseGroundOverlays(kmlText, { sourceName });
  const imageHrefs = overlays.map((overlay) => overlay.href).filter(Boolean);
  const warnings = [];
  const errors = [];

  overlays.forEach((overlay) => {
    warnings.push(...overlay.warnings);
    errors.push(...overlay.errors);
  });

  return {
    kind: detectContentKind(vectorSummary.geometryCount, overlays.length),
    sourceName,
    vector: vectorSummary,
    groundOverlays: overlays,
    imageHrefs,
    hasKmlStyles: /<Style\b/i.test(kmlText) || /<StyleMap\b/i.test(kmlText),
    hasHtmlDescriptions: /<description\b[^>]*>[\s\S]*?<(table|tr|td|div|ul|li|br)\b/i.test(kmlText),
    warnings,
    errors,
    bbox: mergeBboxes([
      vectorSummary.bbox,
      ...overlays.map((overlay) => overlay.bbox),
    ]),
    canPreview: Boolean(vectorSummary.geometryCount || overlays.some((overlay) => overlay.isValid)),
  };
}

export function analyzeKmzFile(filePath) {
  const entries = readZipEntries(filePath);
  validateArchiveEntries(entries);
  const kmlEntries = entries.filter((entry) => getExtension(entry.name) === "kml");
  const imageEntries = entries.filter((entry) => GROUND_OVERLAY_IMAGE_EXTENSIONS.has(getExtension(entry.name)));
  const diagnostics = {
    fileName: path.basename(filePath),
    compressedSize: fs.statSync(filePath).size,
    entries: entries.map((entry) => ({
      name: entry.name,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
    })),
    kmlEntries: kmlEntries.map((entry) => entry.name),
    internalImages: imageEntries.map((entry) => entry.name),
    warnings: [],
    errors: [],
  };

  if (!kmlEntries.length) {
    diagnostics.errors.push("El KMZ no contiene archivos KML.");
    return {
      kind: "unsupported",
      entries,
      kmlEntry: null,
      kmlText: "",
      diagnostics,
      vector: { geometryCount: 0, geometryTypes: [], bbox: null },
      groundOverlays: [],
      bbox: null,
      canPreview: false,
    };
  }

  const analyzed = kmlEntries.map((entry) => {
    const kmlText = readZipEntryText(filePath, entry);
    return {
      entry,
      kmlText,
      analysis: analyzeKmlText(kmlText, { sourceName: entry.name }),
    };
  });
  const selected = choosePrimaryKmlAnalysis(analyzed);
  const overlays = selected.analysis.groundOverlays.map((overlay) => ({
    ...overlay,
    imageEntry: resolveKmzHrefEntry(entries, selected.entry.name, overlay.href),
  }));

  overlays.forEach((overlay) => {
    if (!overlay.imageEntry) {
      overlay.errors.push(`No se encontro la imagen interna referida por ${overlay.href}.`);
      return;
    }
    const extension = getExtension(overlay.imageEntry.name);
    if (!GROUND_OVERLAY_IMAGE_EXTENSIONS.has(extension)) {
      overlay.errors.push(`Formato de imagen no permitido para GroundOverlay: ${overlay.imageEntry.name}.`);
    } else {
      const detectedMime = detectImageMime(readZipEntryBuffer(filePath, overlay.imageEntry));
      if (!isAllowedImageMime(detectedMime, extension)) {
        overlay.errors.push(`La imagen ${overlay.imageEntry.name} no coincide con un MIME permitido.`);
      }
    }
    overlay.isValid = overlay.isValid && overlay.errors.length === 0;
  });

  return {
    kind: detectContentKind(selected.analysis.vector.geometryCount, overlays.length),
    entries,
    kmlEntry: selected.entry,
    kmlText: selected.kmlText,
    diagnostics: {
      ...diagnostics,
      selectedKml: selected.entry.name,
      type: detectContentKind(selected.analysis.vector.geometryCount, overlays.length),
      geometryCount: selected.analysis.vector.geometryCount,
      geometryTypes: selected.analysis.vector.geometryTypes,
      groundOverlayCount: overlays.length,
      hasKmlStyles: selected.analysis.hasKmlStyles,
      hasHtmlDescriptions: selected.analysis.hasHtmlDescriptions,
      bbox: mergeBboxes([selected.analysis.vector.bbox, ...overlays.map((overlay) => overlay.bbox)]),
      warnings: [...diagnostics.warnings, ...selected.analysis.warnings],
      errors: [...diagnostics.errors, ...selected.analysis.errors, ...overlays.flatMap((overlay) => overlay.errors)],
    },
    vector: selected.analysis.vector,
    groundOverlays: overlays,
    bbox: mergeBboxes([selected.analysis.vector.bbox, ...overlays.map((overlay) => overlay.bbox)]),
    canPreview: Boolean(selected.analysis.vector.geometryCount || overlays.some((overlay) => overlay.isValid && overlay.imageEntry)),
  };
}

export function extractGroundOverlayImages({ archivePath, layerId, overlays, outputRoot, publicBaseUrl }) {
  const outputDir = path.join(outputRoot, "processed", layerId, "ground-overlays");
  ensureSafeChildPath(outputRoot, outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  return overlays.map((overlay, index) => {
    if (!overlay.isValid || !overlay.imageEntry) return null;
    const extension = getExtension(overlay.imageEntry.name);
    if (!GROUND_OVERLAY_IMAGE_EXTENSIONS.has(extension)) return null;
    const bytes = readZipEntryBuffer(archivePath, overlay.imageEntry);
    const detectedMime = detectImageMime(bytes);
    if (!isAllowedImageMime(detectedMime, extension)) {
      throw new Error(`La imagen ${overlay.imageEntry.name} no coincide con un MIME permitido.`);
    }

    const fileName = `${String(index + 1).padStart(2, "0")}-${sanitizeFileBaseName(overlay.name || "ground-overlay")}.${extension}`;
    const storagePath = path.join(outputDir, fileName);
    ensureSafeChildPath(outputRoot, storagePath);
    fs.writeFileSync(storagePath, bytes);

    return {
      id: overlay.id || `ground-overlay-${index + 1}`,
      name: overlay.name || `GroundOverlay ${index + 1}`,
      href: overlay.href,
      sourcePath: overlay.imageEntry.name,
      imagePath: storagePath,
      imageUrl: buildPublicFileUrl(publicBaseUrl, storagePath),
      mimeType: detectedMime,
      extension,
      drawOrder: overlay.drawOrder,
      rotation: overlay.rotation,
      bounds: overlay.bounds,
      bbox: overlay.bbox,
      coordinates: overlay.coordinates,
    };
  }).filter(Boolean);
}

export function readZipEntries(filePath) {
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

export function readZipEntryText(filePath, entry) {
  return readZipEntryBuffer(filePath, entry).toString("utf8");
}

export function readZipEntryBuffer(filePath, entry) {
  const buffer = fs.readFileSync(filePath);
  const offset = entry.localHeaderOffset;

  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`No se pudo leer la entrada comprimida: ${entry.name}`);
  }

  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`Metodo de compresion no soportado para ${entry.name}.`);
}

export function validateArchiveEntries(entries, limits = IMPORT_LIMITS) {
  if (!entries.length) {
    throw new Error("El archivo comprimido no contiene entradas legibles.");
  }
  if (entries.length > limits.maxArchiveEntries) {
    throw new Error(`El archivo comprimido excede el maximo de ${limits.maxArchiveEntries} entradas.`);
  }

  let compressedTotal = 0;
  let uncompressedTotal = 0;
  for (const entry of entries) {
    if (isUnsafeArchivePath(entry.name)) {
      throw new Error(`El archivo comprimido contiene una ruta no segura: ${entry.name}`);
    }
    compressedTotal += entry.compressedSize || 0;
    uncompressedTotal += entry.uncompressedSize || 0;
    if ((entry.uncompressedSize || 0) > limits.maxSingleEntryBytes) {
      throw new Error(`La entrada ${entry.name} excede el tamano maximo permitido.`);
    }
  }
  if (compressedTotal > limits.maxCompressedBytes || uncompressedTotal > limits.maxUncompressedBytes) {
    throw new Error("El archivo comprimido excede los limites de seguridad de extraccion.");
  }
}

function choosePrimaryKmlAnalysis(items) {
  return [...items].sort((a, b) => {
    const bScore = scoreKmlAnalysis(b);
    const aScore = scoreKmlAnalysis(a);
    if (bScore !== aScore) return bScore - aScore;
    const aDoc = path.basename(a.entry.name).toLowerCase() === "doc.kml" ? 1 : 0;
    const bDoc = path.basename(b.entry.name).toLowerCase() === "doc.kml" ? 1 : 0;
    return bDoc - aDoc;
  })[0];
}

function scoreKmlAnalysis(item) {
  return item.analysis.vector.geometryCount + item.analysis.groundOverlays.length * 10;
}

function analyzeKmlVectorContent(kmlText) {
  const geometryTypes = new Set();
  let geometryCount = 0;
  KML_VECTOR_TAGS.forEach((tag) => {
    const matches = kmlText.match(new RegExp(`<${tag}\\b`, "gi")) || [];
    if (matches.length) {
      geometryTypes.add(tag);
      geometryCount += matches.length;
    }
  });

  return {
    geometryCount,
    geometryTypes: [...geometryTypes],
    bbox: null,
  };
}

function parseGroundOverlays(kmlText, options = {}) {
  const overlays = [];
  const overlayRegex = /<GroundOverlay\b([^>]*)>([\s\S]*?)<\/GroundOverlay>/gi;
  let match = null;
  let index = 0;

  while ((match = overlayRegex.exec(kmlText))) {
    index += 1;
    const attributes = match[1] || "";
    const body = match[2] || "";
    const name = decodeXmlText(readXmlTag(body, "name")) || `GroundOverlay ${index}`;
    const href = normalizeArchivePath(decodeXmlText(readXmlTag(readXmlTagBody(body, "Icon") || body, "href")));
    const drawOrderValue = readXmlTag(body, "drawOrder");
    const bounds = parseLatLonBox(readXmlTagBody(body, "LatLonBox"));
    const rotation = bounds?.rotation ?? 0;
    const errors = [];
    const warnings = [];

    if (!href) errors.push(`GroundOverlay ${name} no contiene href de imagen.`);
    if (href && isExternalUrl(href)) errors.push(`GroundOverlay ${name} referencia una URL remota no autorizada.`);
    if (href && isUnsafeArchivePath(href)) errors.push(`GroundOverlay ${name} usa una ruta de imagen no segura.`);
    if (!bounds) errors.push(`GroundOverlay ${name} no contiene LatLonBox valido.`);
    if (bounds && rotation !== 0) {
      errors.push(`GroundOverlay ${name} usa rotation=${rotation}; la rotacion distinta de cero aun no se representa con precision.`);
    }

    const bbox = bounds ? [bounds.west, bounds.south, bounds.east, bounds.north] : null;
    overlays.push({
      id: readXmlAttribute(attributes, "id") || `ground-overlay-${index}`,
      name,
      href,
      drawOrder: Number.isFinite(Number(drawOrderValue)) ? Number(drawOrderValue) : index,
      rotation,
      bounds,
      bbox,
      coordinates: bounds
        ? [
            [bounds.west, bounds.north],
            [bounds.east, bounds.north],
            [bounds.east, bounds.south],
            [bounds.west, bounds.south],
          ]
        : null,
      isValid: !errors.length,
      errors,
      warnings,
      sourceName: options.sourceName || "",
    });
  }

  return overlays;
}

function parseLatLonBox(body) {
  if (!body) return null;
  const north = toFiniteNumber(readXmlTag(body, "north"));
  const south = toFiniteNumber(readXmlTag(body, "south"));
  const east = toFiniteNumber(readXmlTag(body, "east"));
  const west = toFiniteNumber(readXmlTag(body, "west"));
  const rotation = toFiniteNumber(readXmlTag(body, "rotation")) ?? 0;

  if (![north, south, east, west, rotation].every(Number.isFinite)) return null;
  if (north <= south || east <= west) return null;
  if (north > 90 || south < -90 || east > 180 || west < -180) return null;

  return { north, south, east, west, rotation };
}

function resolveKmzHrefEntry(entries, kmlEntryName, href) {
  if (!href || isExternalUrl(href) || isUnsafeArchivePath(href)) return null;
  const normalizedHref = normalizeArchivePath(href);
  const kmlDir = path.posix.dirname(kmlEntryName);
  const candidates = [
    normalizedHref,
    normalizeArchivePath(path.posix.join(kmlDir === "." ? "" : kmlDir, normalizedHref)),
    normalizeArchivePath(path.posix.basename(normalizedHref)),
  ];
  const lowerCandidates = new Set(candidates.map((candidate) => candidate.toLowerCase()));
  return entries.find((entry) => lowerCandidates.has(normalizeArchivePath(entry.name).toLowerCase())) || null;
}

function detectContentKind(vectorCount, overlayCount) {
  if (vectorCount > 0 && overlayCount > 0) return "mixed";
  if (overlayCount > 0) return "ground-overlay";
  if (vectorCount > 0) return "vector";
  return "unsupported";
}

function mergeBboxes(bboxes) {
  const valid = bboxes.filter((bbox) => Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite));
  if (!valid.length) return null;
  return valid.reduce(
    (acc, bbox) => [
      Math.min(acc[0], bbox[0]),
      Math.min(acc[1], bbox[1]),
      Math.max(acc[2], bbox[2]),
      Math.max(acc[3], bbox[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity]
  );
}

function detectImageMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

function isAllowedImageMime(mime, extension) {
  if (extension === "png") return mime === "image/png";
  if (extension === "jpg" || extension === "jpeg") return mime === "image/jpeg";
  if (extension === "webp") return mime === "image/webp";
  return false;
}

function ensureSafeChildPath(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Ruta de salida procesada no permitida.");
  }
}

function buildPublicFileUrl(publicBaseUrl, storagePath) {
  const normalized = storagePath.replace(/\\/g, "/");
  return `${publicBaseUrl}/${normalized}`;
}

function sanitizeFileBaseName(value) {
  return String(value || "ground-overlay")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^.]+$/u, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "ground-overlay";
}

function normalizeArchivePath(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\/+/u, "");
}

function getExtension(filename) {
  return path.extname(String(filename || "")).replace(".", "").toLowerCase();
}

function isExternalUrl(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(String(value || ""));
}

function isUnsafeArchivePath(value) {
  const normalized = normalizeArchivePath(value);
  return (
    !normalized ||
    path.isAbsolute(normalized) ||
    normalized.includes("..") ||
    normalized.includes(":") ||
    normalized.startsWith("/") ||
    normalized.startsWith("\\")
  );
}

function readXmlTag(value, tagName) {
  const body = readXmlTagBody(value, tagName);
  return body ? decodeXmlText(body.replace(/<[^>]*>/g, "").trim()) : "";
}

function readXmlTagBody(value, tagName) {
  const match = String(value || "").match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1].trim() : "";
}

function readXmlAttribute(attributes, name) {
  const match = String(attributes || "").match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
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

function toFiniteNumber(value) {
  const number = Number(String(value || "").trim());
  return Number.isFinite(number) ? number : null;
}
