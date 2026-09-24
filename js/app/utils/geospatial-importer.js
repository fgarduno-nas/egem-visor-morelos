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
  const iconColors = await readKmzIconColors(entries, selected.entry.name);
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
    vectorLegend: buildKmlVectorLegend(selected.text, { iconColors }),
    vectorSublayers: analyzeKmlVectorSublayers(selected.text, { iconColors }),
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
    extractedMetadata: extractKmlMetadata(kmlText),
    vectorLegend: buildKmlVectorLegend(kmlText),
    vectorSublayers: analyzeKmlVectorSublayers(kmlText),
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
  const placemarkRegex = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let match = null;
  while ((match = placemarkRegex.exec(kmlText))) {
    const body = match[1] || "";
    let hasGeometry = false;
    VECTOR_TAGS.forEach((tag) => {
      const matches = body.match(new RegExp(`<${tag}\\b`, "gi")) || [];
      if (!matches.length) return;
      hasGeometry = true;
      if (tag !== "MultiGeometry" && tag !== "GeometryCollection") geometryTypes.add(tag);
    });
    if (hasGeometry) geometryCount += 1;
  }
  return { geometryCount, geometryTypes: [...geometryTypes], bbox: null };
}

export function extractKmlMetadata(kmlText) {
  const folderDescription = decodeCdata(readFirstFolderDescription(kmlText));
  const text = normalizeText(stripHtml(folderDescription));
  const scale = text.match(/Escala\s*:?\s*(1\s*:\s*[\d,.]+)/iu)?.[1]?.replace(/\s+/g, "") || null;
  const years = [...new Set([...text.matchAll(/\b(?:19|20)\d{2}\b/g)].map((item) => item[0]))].sort();
  const sources = [];
  if (/\bINEGI\b|Instituto Nacional de Estad[íi]stica y Geograf[íi]a/iu.test(text)) sources.push("Instituto Nacional de Estadística y Geografía - INEGI");
  if (/\bCONAGUA\b|\bSINA\b|Sistema Nacional de Informaci[óo]n del Agua/iu.test(text)) sources.push("Sistema Nacional de Información del Agua - CONAGUA-SINA");
  return {
    description: { value: text || null, origin: text ? "extraído del archivo" : "valor de fallback" },
    scaleOrResolution: { value: scale || "No especificada por la fuente.", origin: scale ? "extraído del archivo" : "valor de fallback" },
    crs: { value: "WGS 84 (EPSG:4326)", origin: "inferido por estándar KML", note: "CRS de intercambio/visualización del KML." },
    source: { value: sources.join("; ") || null, origin: sources.length ? "extraído del archivo" : "valor de fallback" },
    updatedAt: { value: years.at(-1) || null, years, origin: years.length ? "extraído del archivo" : "valor de fallback" },
    responsibleAgency: { value: null, origin: "ingresado por el usuario" },
  };
}

export function buildKmlVectorLegend(kmlText, options = {}) {
  const styles = readBasicKmlStyles(kmlText, options);
  const placemarks = readFolderAwareLegendPlacemarks(kmlText);
  const folderLegends = [...groupLegendPlacemarksByFolder(placemarks).entries()]
    .map(([folder, folderPlacemarks]) => {
      const legend = buildIntensityPolygonLegend(folderPlacemarks, styles) || buildCategoricalStyleLegend(folderPlacemarks, styles);
      return legend ? {
        ...legend,
        appliesToFolder: folder || null,
        appliesToGeometryRole: inferGeometryRole(folder, folderPlacemarks[0]?.geometryType),
      } : null;
    })
    .filter(Boolean);
  return folderLegends.find((legend) => normalizeLegendKey(legend.field).includes("intens")) || folderLegends[0] || null;
}

export function analyzeKmlVectorSublayers(kmlText, options = {}) {
  const styles = readBasicKmlStyles(kmlText, options);
  return [...groupLegendPlacemarksByFolder(readFolderAwareLegendPlacemarks(kmlText)).entries()].map(([folder, placemarks]) => {
    const legend = buildIntensityPolygonLegend(placemarks, styles) || buildCategoricalStyleLegend(placemarks, styles);
    const styleUrls = [...new Set(placemarks.map((item) => item.styleUrl).filter(Boolean))];
    return {
      id: normalizeSublayerId(folder || "kml"),
      title: folder || "Sin carpeta",
      folder: folder || null,
      placemarkCount: placemarks.length,
      geometryRole: inferGeometryRole(folder, placemarks[0]?.geometryType),
      geometryCounts: countPlacemarkGeometries(placemarks),
      styleUrls,
      attributeFields: [...new Set(placemarks.flatMap((item) => Object.keys(item.attributes || {})))].sort(),
      legendField: legend?.styleField || legend?.field || null,
      legend: legend ? { ...legend, appliesToFolder: folder || null } : null,
      symbology: legend ? "legend" : styleUrls.length <= 1 ? "file-style" : "file-style-mixed",
    };
  });
}

function readFolderAwareLegendPlacemarks(kmlText) {
  const placemarks = [];
  const folderStack = [];
  const tokenRegex = /<Folder\b[^>]*>|<\/Folder>|<Placemark\b[^>]*>[\s\S]*?<\/Placemark>/gi;
  let match = null;
  while ((match = tokenRegex.exec(kmlText))) {
    const token = match[0] || "";
    if (/^<Folder\b/i.test(token)) {
      const bodyStart = tokenRegex.lastIndex;
      const nextToken = kmlText.slice(bodyStart).search(/<Folder\b|<Placemark\b|<\/Folder>/i);
      const directBody = nextToken >= 0 ? kmlText.slice(bodyStart, bodyStart + nextToken) : "";
      folderStack.push(decodeXmlText(readXmlTag(directBody, "name")) || null);
      continue;
    }
    if (/^<\/Folder>/i.test(token)) {
      folderStack.pop();
      continue;
    }
    const body = token.match(/^<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>$/i)?.[1] || "";
    const folder = [...folderStack].reverse().find(Boolean) || null;
    placemarks.push({
      folder,
      styleUrl: readXmlTag(body, "styleUrl"),
      attributes: parseDescriptionTableAttributes(decodeCdata(readXmlTagBody(body, "description"))),
      geometryType: getKmlPlacemarkGeometryType(body),
      geometryRole: inferGeometryRole(folder, getKmlPlacemarkGeometryType(body)),
    });
  }
  return placemarks;
}

function groupLegendPlacemarksByFolder(placemarks) {
  return placemarks.reduce((groups, placemark) => {
    const key = placemark.folder || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(placemark);
    return groups;
  }, new Map());
}

function countPlacemarkGeometries(placemarks) {
  return placemarks.reduce((counts, placemark) => {
    const type = placemark.geometryType || "Unknown";
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
}

function getKmlPlacemarkGeometryType(body) {
  const hasPoint = /<Point\b/i.test(body);
  const hasLine = /<LineString\b/i.test(body);
  const hasPolygon = /<Polygon\b/i.test(body);
  if ([hasPoint, hasLine, hasPolygon].filter(Boolean).length > 1 || /<MultiGeometry\b/i.test(body)) return "MultiGeometry";
  if (hasPoint) return "Point";
  if (hasLine) return "LineString";
  if (hasPolygon) return "Polygon";
  return "Unknown";
}

function inferGeometryRole(folder, geometryType) {
  const key = normalizeLegendKey(folder || "");
  if (key.includes("manantial")) return "manantial";
  if (key.includes("pozo")) return "pozo";
  if (key.includes("estanque")) return "estanque";
  if (key.includes("acuifero")) return "acuifero";
  if (key.includes("veda")) return "vedas";
  if (key.includes("descarga")) return "descargas-sin-tratamientos";
  if (String(geometryType || "").toLowerCase().includes("point")) return "point";
  if (String(geometryType || "").toLowerCase().includes("polygon")) return "polygon";
  return "kml-feature";
}

function normalizeSublayerId(value) {
  return normalizeLegendKey(value || "kml")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "kml";
}

function buildIntensityPolygonLegend(placemarks, styles) {
  const classes = new Map();
  for (const placemark of placemarks) {
    const style = styles.get(placemark.styleUrl);
    const label = normalizeLegendIntensity(placemark.attributes.Intensidad || placemark.attributes.Intensid_1 || placemark.attributes.Intensidad_1);
    if (!label || !style?.fill) continue;
    const key = normalizeLegendKey(label);
    if (!classes.has(key)) {
      classes.set(key, {
        label,
        value: label,
        color: style.fill,
        outlineColor: style.stroke || "#f0f0f0",
        order: getLegendOrder(label),
        count: 0,
      });
    }
    classes.get(key).count += 1;
  }
  const ordered = [...classes.values()].sort((a, b) => a.order - b.order);
  return ordered.length ? { type: "categorical", field: "Intensidad", styleField: "Intensidad", classes: ordered } : null;
}

function buildCategoricalStyleLegend(placemarks, styles) {
  const candidates = new Map();
  for (const placemark of placemarks) {
    if (!placemark.styleUrl || !styles.has(placemark.styleUrl)) continue;
    Object.entries(placemark.attributes || {}).forEach(([field, rawValue]) => {
      const value = normalizeText(rawValue);
      if (!isUsableLegendField(field, value)) return;
      if (!candidates.has(field)) candidates.set(field, new Map());
      const byValue = candidates.get(field);
      if (!byValue.has(value)) byValue.set(value, { styleUrls: new Set(), count: 0 });
      byValue.get(value).styleUrls.add(placemark.styleUrl);
      byValue.get(value).count += 1;
    });
  }
  const selected = [...candidates.entries()]
    .map(([field, values]) => {
      const rows = [...values.entries()];
      const styleToValue = new Map();
      let exact = rows.length >= 2;
      rows.forEach(([value, info]) => {
        if (info.styleUrls.size !== 1) exact = false;
        const styleUrl = [...info.styleUrls][0];
        if (!styleUrl || styleToValue.has(styleUrl)) exact = false;
        styleToValue.set(styleUrl, value);
      });
      return { field, rows, exact, styleCount: styleToValue.size };
    })
    .filter((candidate) => candidate.exact && candidate.rows.length === candidate.styleCount)
    .sort((a, b) => scoreLegendField(b.field) - scoreLegendField(a.field))[0];
  if (!selected) return null;
  return {
    type: "categorical",
    field: selected.field,
    styleField: selected.field,
    classes: selected.rows.map(([label, info], index) => {
      const styleUrl = [...info.styleUrls][0];
      const style = styles.get(styleUrl);
      return {
        label,
        value: label,
        color: style?.icon || style?.fill || style?.stroke || "#7a203a",
        iconHref: style?.iconHref || null,
        styleUrl,
        order: index + 1,
        count: info.count,
      };
    }),
  };
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

function readFirstFolderDescription(kmlText) {
  const text = String(kmlText || "");
  const documentBody = text.match(/<Document\b[^>]*>([\s\S]*?)<\/Document>/i)?.[1] || "";
  const folderBody = text.match(/<Folder\b[^>]*>([\s\S]*?)<\/Folder>/i)?.[1] || "";
  return readDirectDescription(documentBody) || readDirectDescription(folderBody) || "";
}

function readDirectDescription(body) {
  const scoped = String(body || "").split(/<Placemark\b|<Folder\b/i)[0] || "";
  return scoped.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i)?.[1] || "";
}

function decodeCdata(value) {
  return decodeXmlText(String(value || "").replace(/^<!\[CDATA\[/iu, "").replace(/\]\]>$/u, ""));
}

function stripHtml(value) {
  return decodeXmlText(String(value || "").replace(/<[^>]*>/gu, " "));
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

async function readKmzIconColors(entries, kmlEntryName) {
  const colors = new Map();
  const kmlDir = dirname(kmlEntryName);
  const iconEntries = entries.filter((entry) => !entry.dir && getExtension(entry.name) === "png");
  await Promise.all(iconEntries.map(async (entry) => {
    const blob = await entry.async("blob");
    const color = await detectDominantPngBlobColor(blob).catch(() => null);
    const normalized = normalizeArchivePath(entry.name);
    colors.set(normalized, color);
    colors.set(basename(normalized), color);
    if (kmlDir && kmlDir !== ".") colors.set(normalizeArchivePath(normalized.replace(`${kmlDir}/`, "")), color);
  }));
  return colors;
}

function readBasicKmlStyles(kmlText, options = {}) {
  const styles = new Map();
  const styleRegex = /<Style\b([^>]*)>([\s\S]*?)<\/Style>/gi;
  let match = null;
  while ((match = styleRegex.exec(kmlText))) {
    const id = readXmlAttribute(match[1], "id");
    if (!id) continue;
    const polyStyle = readXmlTagBody(match[2], "PolyStyle");
    const lineStyle = readXmlTagBody(match[2], "LineStyle");
    const iconStyle = readXmlTagBody(match[2], "IconStyle");
    const fill = polyStyle ? parseKmlColor(readXmlTag(polyStyle, "color")) : null;
    const stroke = lineStyle ? parseKmlColor(readXmlTag(lineStyle, "color")) : null;
    const icon = iconStyle ? parseKmlColor(readXmlTag(iconStyle, "color")) : null;
    const iconHref = iconStyle ? readXmlTag(readXmlTagBody(iconStyle, "Icon"), "href") || null : null;
    styles.set(`#${id}`, {
      fill: fill?.hex || null,
      stroke: stroke?.hex || null,
      icon: icon?.opacity > 0 ? icon.hex : options.iconColors?.get(normalizeArchivePath(iconHref)) || options.iconColors?.get(basename(iconHref)) || null,
      iconHref,
    });
  }
  return styles;
}

function isUsableLegendField(field, value) {
  const normalizedField = normalizeLegendKey(field);
  if (!field || !value) return false;
  if (/^(fid|id|objectid|clave|cve|mun ?cve|lat|long|lon|altitud|elev|caudal|shape)/iu.test(normalizedField)) return false;
  if (value.length > 80) return false;
  return true;
}

function scoreLegendField(field) {
  const normalized = normalizeLegendKey(field);
  if (normalized.includes("status") || normalized.includes("estado")) return 100;
  if (normalized.includes("tipo")) return 80;
  if (normalized.includes("intens")) return 70;
  if (normalized.includes("clas")) return 60;
  return 10;
}

async function detectDominantPngBlobColor(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const colors = new Map();
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha < 16) continue;
    const color = `#${[data[index], data[index + 1], data[index + 2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    colors.set(color, (colors.get(color) || 0) + 1);
  }
  bitmap.close?.();
  return [...colors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function parseDescriptionTableAttributes(description) {
  const attributes = {};
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/giu;
  let rowMatch = null;
  while ((rowMatch = rowRegex.exec(description || ""))) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/giu)]
      .map((cell) => normalizeText(stripHtml(cell[1])));
    if (cells.length >= 2 && cells[0] && cells[1]) attributes[cells[0].replace(/:$/u, "").trim()] = cells[1];
  }
  return attributes;
}

function normalizeLegendIntensity(value) {
  const labels = {
    "muy alto": "Muy alto",
    alto: "Alto",
    medio: "Medio",
    bajo: "Bajo",
    "muy bajo": "Muy bajo",
  };
  return labels[normalizeLegendKey(value).replace(/\s+/gu, " ").trim()] || normalizeText(value);
}

function getLegendOrder(label) {
  return new Map([
    ["muy alto", 1],
    ["alto", 2],
    ["medio", 3],
    ["bajo", 4],
    ["muy bajo", 5],
  ]).get(normalizeLegendKey(label).replace(/\s+/gu, " ").trim()) || 100;
}

function normalizeLegendKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
}

function parseKmlColor(value) {
  const cleaned = String(value || "").trim().replace("#", "");
  if (!/^[0-9a-f]{8}$/i.test(cleaned)) return null;
  return {
    hex: `#${cleaned.slice(6, 8)}${cleaned.slice(4, 6)}${cleaned.slice(2, 4)}`.toLowerCase(),
    opacity: Number((parseInt(cleaned.slice(0, 2), 16) / 255).toFixed(3)),
  };
}
