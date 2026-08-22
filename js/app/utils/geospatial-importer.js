export const GROUND_OVERLAY_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

const VECTOR_TAGS = ["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "MultiGeometry", "GeometryCollection"];

export async function analyzeGeospatialFile(file, options = {}) {
  const extension = getExtension(file.name);
  if (extension === "kmz") {
    return analyzeKmzFile(file, options);
  }
  if (extension === "kml") {
    const text = await file.text();
    return analyzeKmlText(text, { ...options, sourceName: file.name });
  }
  return {
    kind: "unknown",
    fileName: file.name,
    compressedSize: file.size,
    vector: { geometryCount: 0, geometryTypes: [], bbox: null },
    groundOverlays: [],
    warnings: [],
    errors: [],
    canPreview: false,
  };
}

export async function analyzeKmzFile(file, options = {}) {
  const zip = await window.JSZip.loadAsync(file);
  const entries = Object.values(zip.files);
  validateArchiveEntries(entries, file.size);
  const kmlEntries = entries.filter((entry) => !entry.dir && getExtension(entry.name) === "kml");
  const imageEntries = entries.filter((entry) => !entry.dir && GROUND_OVERLAY_IMAGE_EXTENSIONS.has(getExtension(entry.name)));

  if (!kmlEntries.length) {
    return {
      kind: "unsupported",
      fileName: file.name,
      compressedSize: file.size,
      kmlEntries: [],
      internalImages: imageEntries.map((entry) => entry.name),
      vector: { geometryCount: 0, geometryTypes: [], bbox: null },
      groundOverlays: [],
      warnings: [],
      errors: ["El KMZ no contiene archivos KML."],
      canPreview: false,
    };
  }

  const analyzed = await Promise.all(
    kmlEntries.map(async (entry) => ({
      entry,
      text: await entry.async("text"),
    }))
  );
  const selected = choosePrimaryKmlAnalysis(
    analyzed.map((item) => ({
      ...item,
      analysis: analyzeKmlText(item.text, { sourceName: item.entry.name }),
    }))
  );
  const overlays = await Promise.all(
    selected.analysis.groundOverlays.map(async (overlay) => {
      const imageEntry = resolveKmzHrefEntry(entries, selected.entry.name, overlay.href);
      const errors = [...overlay.errors];
      if (!imageEntry) {
        errors.push(`No se encontro la imagen interna referida por ${overlay.href}.`);
      }
      if (imageEntry && !GROUND_OVERLAY_IMAGE_EXTENSIONS.has(getExtension(imageEntry.name))) {
        errors.push(`Formato de imagen no permitido para GroundOverlay: ${imageEntry.name}.`);
      }
      if (imageEntry) {
        const bytes = await imageEntry.async("uint8array");
        const mimeType = detectImageMime(bytes);
        if (!isAllowedImageMime(mimeType, getExtension(imageEntry.name))) {
          errors.push(`La imagen ${imageEntry.name} no coincide con PNG, JPG o WebP válido.`);
        }
      }
      return {
        ...overlay,
        imageEntryName: imageEntry?.name || null,
        imageBlob: imageEntry ? await imageEntry.async("blob") : null,
        errors,
        isValid: overlay.isValid && Boolean(imageEntry) && !errors.length,
      };
    })
  );

  return {
    ...selected.analysis,
    kind: detectKind(selected.analysis.vector.geometryCount, overlays.length),
    fileName: file.name,
    compressedSize: file.size,
    selectedKml: selected.entry.name,
    kmlText: selected.text,
    kmlEntries: kmlEntries.map((entry) => entry.name),
    internalImages: imageEntries.map((entry) => entry.name),
    groundOverlays: overlays,
    bbox: mergeBboxes([selected.analysis.vector.bbox, ...overlays.map((overlay) => overlay.bbox)]),
    canPreview: Boolean(selected.analysis.vector.geometryCount || overlays.some((overlay) => overlay.isValid)),
  };
}

export function analyzeKmlText(kmlText, options = {}) {
  const vector = analyzeKmlVectorContent(kmlText);
  const groundOverlays = parseGroundOverlays(kmlText);
  const warnings = groundOverlays.flatMap((overlay) => overlay.warnings);
  const errors = groundOverlays.flatMap((overlay) => overlay.errors);
  return {
    kind: detectKind(vector.geometryCount, groundOverlays.length),
    sourceName: options.sourceName || "",
    vector,
    groundOverlays,
    hasKmlStyles: /<Style\b/i.test(kmlText) || /<StyleMap\b/i.test(kmlText),
    hasHtmlDescriptions: /<description\b[^>]*>[\s\S]*?<(table|tr|td|div|ul|li|br)\b/i.test(kmlText),
    warnings,
    errors,
    bbox: mergeBboxes([vector.bbox, ...groundOverlays.map((overlay) => overlay.bbox)]),
    canPreview: Boolean(vector.geometryCount || groundOverlays.some((overlay) => overlay.isValid)),
  };
}

export function createGroundOverlayObjectUrls(overlays) {
  return overlays
    .filter((overlay) => overlay.isValid && overlay.imageBlob)
    .map((overlay, index) => ({
      id: overlay.id || `ground-overlay-${index + 1}`,
      name: overlay.name || `GroundOverlay ${index + 1}`,
      imageUrl: URL.createObjectURL(overlay.imageBlob),
      coordinates: overlay.coordinates,
      bounds: overlay.bounds,
      bbox: overlay.bbox,
      rotation: overlay.rotation,
      drawOrder: overlay.drawOrder,
      revokeUrl: true,
    }));
}

function choosePrimaryKmlAnalysis(items) {
  return [...items].sort((a, b) => {
    const bScore = b.analysis.vector.geometryCount + b.analysis.groundOverlays.length * 10;
    const aScore = a.analysis.vector.geometryCount + a.analysis.groundOverlays.length * 10;
    if (bScore !== aScore) return bScore - aScore;
    return (basename(b.entry.name).toLowerCase() === "doc.kml" ? 1 : 0) - (basename(a.entry.name).toLowerCase() === "doc.kml" ? 1 : 0);
  })[0];
}

function analyzeKmlVectorContent(kmlText) {
  const geometryTypes = new Set();
  let geometryCount = 0;
  VECTOR_TAGS.forEach((tag) => {
    const matches = kmlText.match(new RegExp(`<${tag}\\b`, "gi")) || [];
    if (matches.length) {
      geometryTypes.add(tag);
      geometryCount += matches.length;
    }
  });
  return { geometryCount, geometryTypes: [...geometryTypes], bbox: null };
}

function parseGroundOverlays(kmlText) {
  const overlays = [];
  const regex = /<GroundOverlay\b([^>]*)>([\s\S]*?)<\/GroundOverlay>/gi;
  let match = null;
  let index = 0;
  while ((match = regex.exec(kmlText))) {
    index += 1;
    const body = match[2] || "";
    const name = decodeXmlText(readXmlTag(body, "name")) || `GroundOverlay ${index}`;
    const href = normalizeArchivePath(decodeXmlText(readXmlTag(readXmlTagBody(body, "Icon") || body, "href")));
    const bounds = parseLatLonBox(readXmlTagBody(body, "LatLonBox"));
    const rotation = bounds?.rotation ?? 0;
    const errors = [];
    if (!href) errors.push(`GroundOverlay ${name} no contiene href de imagen.`);
    if (href && isExternalUrl(href)) errors.push(`GroundOverlay ${name} referencia una URL remota no autorizada.`);
    if (href && isUnsafeArchivePath(href)) errors.push(`GroundOverlay ${name} usa una ruta de imagen no segura.`);
    if (!bounds) errors.push(`GroundOverlay ${name} no contiene LatLonBox válido.`);
    if (bounds && rotation !== 0) errors.push(`GroundOverlay ${name} usa rotation=${rotation}; la rotación distinta de cero aún no se representa con precisión.`);
    overlays.push({
      id: readXmlAttribute(match[1], "id") || `ground-overlay-${index}`,
      name,
      href,
      drawOrder: Number(readXmlTag(body, "drawOrder")) || index,
      rotation,
      bounds,
      bbox: bounds ? [bounds.west, bounds.south, bounds.east, bounds.north] : null,
      coordinates: bounds
        ? [
            [bounds.west, bounds.north],
            [bounds.east, bounds.north],
            [bounds.east, bounds.south],
            [bounds.west, bounds.south],
          ]
        : null,
      errors,
      warnings: [],
      isValid: !errors.length,
    });
  }
  return overlays;
}

function validateArchiveEntries(entries, compressedSize) {
  if (!entries.length) throw new Error("El KMZ no contiene entradas legibles.");
  if (entries.length > 250) throw new Error("El KMZ excede el máximo de entradas permitido.");
  if (compressedSize > 120 * 1024 * 1024) throw new Error("El KMZ excede el tamaño máximo comprimido permitido.");
  entries.forEach((entry) => {
    if (isUnsafeArchivePath(entry.name)) throw new Error(`El KMZ contiene una ruta no segura: ${entry.name}`);
    const size = Number(entry._data?.uncompressedSize || 0);
    if (size > 120 * 1024 * 1024) throw new Error(`La entrada ${entry.name} excede el tamaño permitido.`);
  });
}

function parseLatLonBox(body) {
  if (!body) return null;
  const north = Number(readXmlTag(body, "north"));
  const south = Number(readXmlTag(body, "south"));
  const east = Number(readXmlTag(body, "east"));
  const west = Number(readXmlTag(body, "west"));
  const rotationValue = readXmlTag(body, "rotation");
  const rotation = rotationValue === "" ? 0 : Number(rotationValue);
  if (![north, south, east, west, rotation].every(Number.isFinite)) return null;
  if (north <= south || east <= west) return null;
  if (north > 90 || south < -90 || east > 180 || west < -180) return null;
  return { north, south, east, west, rotation };
}

function resolveKmzHrefEntry(entries, kmlEntryName, href) {
  if (!href || isExternalUrl(href) || isUnsafeArchivePath(href)) return null;
  const normalizedHref = normalizeArchivePath(href);
  const kmlDir = dirname(kmlEntryName);
  const candidates = new Set([
    normalizedHref,
    normalizeArchivePath(`${kmlDir && kmlDir !== "." ? `${kmlDir}/` : ""}${normalizedHref}`),
    basename(normalizedHref),
  ].map((item) => item.toLowerCase()));
  return entries.find((entry) => candidates.has(normalizeArchivePath(entry.name).toLowerCase())) || null;
}

function detectImageMime(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return "application/octet-stream";
}

function isAllowedImageMime(mimeType, extension) {
  if (extension === "png") return mimeType === "image/png";
  if (extension === "jpg" || extension === "jpeg") return mimeType === "image/jpeg";
  if (extension === "webp") return mimeType === "image/webp";
  return false;
}

function mergeBboxes(bboxes) {
  const valid = bboxes.filter((bbox) => Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite));
  if (!valid.length) return null;
  return valid.reduce((acc, bbox) => [
    Math.min(acc[0], bbox[0]),
    Math.min(acc[1], bbox[1]),
    Math.max(acc[2], bbox[2]),
    Math.max(acc[3], bbox[3]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
}

function detectKind(vectorCount, overlayCount) {
  if (vectorCount > 0 && overlayCount > 0) return "mixed";
  if (overlayCount > 0) return "ground-overlay";
  if (vectorCount > 0) return "vector";
  return "unsupported";
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

function isExternalUrl(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(String(value || ""));
}

function isUnsafeArchivePath(value) {
  const normalized = normalizeArchivePath(value);
  return !normalized || normalized.includes("..") || normalized.includes(":") || normalized.startsWith("/") || normalized.startsWith("\\");
}

function normalizeArchivePath(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\/+/u, "");
}

function getExtension(filename) {
  return String(filename || "").split(".").pop().toLowerCase();
}

function basename(value) {
  return normalizeArchivePath(value).split("/").pop() || "";
}

function dirname(value) {
  const normalized = normalizeArchivePath(value);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "." : normalized.slice(0, index);
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.slice(start, end));
}
