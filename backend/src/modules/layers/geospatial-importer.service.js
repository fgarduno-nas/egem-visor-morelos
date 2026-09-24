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
    extractedMetadata: extractKmlMetadata(kmlText),
    vectorLegend: buildKmlVectorLegend(kmlText),
    vectorSublayers: analyzeKmlVectorSublayers(kmlText),
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

  const legendOptions = {
    archivePath: filePath,
    entries,
    kmlEntryName: selected.entry.name,
  };
  const vectorLegend = buildKmlVectorLegend(selected.kmlText, legendOptions);
  const vectorSublayers = analyzeKmlVectorSublayers(selected.kmlText, legendOptions);

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
      extractedMetadata: selected.analysis.extractedMetadata,
      vectorLegend,
      vectorSublayers,
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
    throw new Error(`El archivo comprimido excede el máximo de ${limits.maxArchiveEntries} entradas.`);
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
      throw new Error(`La entrada ${entry.name} excede el tamaño máximo permitido.`);
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
  let placemarkGeometryCount = 0;
  const placemarkRegex = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let match = null;
  while ((match = placemarkRegex.exec(kmlText))) {
    const body = match[1] || "";
    let hasGeometry = false;
    KML_VECTOR_TAGS.forEach((tag) => {
      const matches = body.match(new RegExp(`<${tag}\\b`, "gi")) || [];
      if (!matches.length) return;
      hasGeometry = true;
      if (tag !== "MultiGeometry" && tag !== "GeometryCollection") {
        geometryTypes.add(tag);
      }
    });
    if (hasGeometry) placemarkGeometryCount += 1;
  }

  return {
    geometryCount: placemarkGeometryCount,
    geometryTypes: [...geometryTypes],
    bbox: null,
  };
}

export function extractKmlMetadata(kmlText) {
  const folderDescription = decodeCdata(readFirstFolderDescription(kmlText));
  const text = normalizeText(stripHtml(folderDescription));
  const scale = extractScale(text);
  const years = [...new Set([...text.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => match[0]))].sort();
  const sources = [];
  if (/\bINEGI\b|Instituto Nacional de Estad[íi]stica y Geograf[íi]a/iu.test(text)) {
    sources.push("Instituto Nacional de Estadística y Geografía - INEGI");
  }
  if (/\bCONAGUA\b|\bSINA\b|Sistema Nacional de Informaci[óo]n del Agua/iu.test(text)) {
    sources.push("Sistema Nacional de Información del Agua - CONAGUA-SINA");
  }

  return {
    description: {
      value: text || null,
      origin: text ? "extraído del archivo" : "valor de fallback",
    },
    scaleOrResolution: {
      value: scale || "No especificada por la fuente.",
      origin: scale ? "extraído del archivo" : "valor de fallback",
    },
    crs: {
      value: "WGS 84 (EPSG:4326)",
      origin: "inferido por estándar KML",
      note: "CRS de intercambio/visualización declarado por el formato KML.",
    },
    source: {
      value: sources.join("; ") || null,
      origin: sources.length ? "extraído del archivo" : "valor de fallback",
    },
    updatedAt: {
      value: years.at(-1) || null,
      years,
      origin: years.length ? "extraído del archivo" : "valor de fallback",
    },
    responsibleAgency: {
      value: null,
      origin: "ingresado por el usuario",
    },
  };
}

export function buildKmlVectorLegend(kmlText, options = {}) {
  const styles = readBasicKmlStyles(kmlText, options);
  const placemarks = readFolderAwareLegendPlacemarks(kmlText);
  const grouped = groupLegendPlacemarksByFolder(placemarks);
  const folderLegends = [...grouped.entries()]
    .map(([folder, folderPlacemarks]) => {
      const intensityLegend = buildIntensityPolygonLegend(folderPlacemarks, styles);
      const categoricalLegend = intensityLegend || buildCategoricalStyleLegend(folderPlacemarks, styles);
      if (!categoricalLegend) return null;
      return {
        ...categoricalLegend,
        appliesToFolder: folder || null,
        appliesToGeometryRole: inferGeometryRole(folder, folderPlacemarks[0]?.geometryType),
        provenance: {
          scope: folder ? "kml-folder" : "kml-document",
          folder: folder || null,
          confidence: intensityLegend ? "high" : "medium",
        },
      };
    })
    .filter(Boolean);

  const selected = folderLegends.find((legend) => normalizeLegendKey(legend.field).includes("intens")) || folderLegends[0] || null;
  if (selected) return selected;

  const intensityLegend = buildIntensityPolygonLegend(placemarks, styles);
  if (intensityLegend) return intensityLegend;
  return buildCategoricalStyleLegend(placemarks, styles);
}

function readLegendPlacemarks(kmlText) {
  const placemarks = [];
  const placemarkRegex = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let match = null;

  while ((match = placemarkRegex.exec(kmlText))) {
    const body = match[1] || "";
    const description = decodeCdata(readXmlTagBody(body, "description"));
    placemarks.push({
      styleUrl: readXmlTag(body, "styleUrl"),
      attributes: parseDescriptionTableAttributes(description),
      geometryType: getKmlPlacemarkGeometryType(body),
    });
  }

  return placemarks;
}

export function analyzeKmlVectorSublayers(kmlText, options = {}) {
  const styles = readBasicKmlStyles(kmlText, options);
  const placemarks = readFolderAwareLegendPlacemarks(kmlText);
  const grouped = groupLegendPlacemarksByFolder(placemarks);

  return [...grouped.entries()].map(([folder, folderPlacemarks]) => {
    const geometryCounts = countPlacemarkGeometries(folderPlacemarks);
    const intensityLegend = buildIntensityPolygonLegend(folderPlacemarks, styles);
    const categoricalLegend = intensityLegend || buildCategoricalStyleLegend(folderPlacemarks, styles);
    const styleUrls = [...new Set(folderPlacemarks.map((item) => item.styleUrl).filter(Boolean))];
    const attributeFields = [...new Set(folderPlacemarks.flatMap((item) => Object.keys(item.attributes || {})))].sort();
    const geometryRole = inferGeometryRole(folder, folderPlacemarks[0]?.geometryType);
    const singleStyle = styleUrls.length <= 1;

    return {
      id: normalizeSublayerId(folder || geometryRole || "kml-document"),
      title: folder || "Sin carpeta",
      folder: folder || null,
      placemarkCount: folderPlacemarks.length,
      geometryRole,
      geometryCounts,
      styleUrls,
      attributeFields,
      legendField: categoricalLegend?.styleField || categoricalLegend?.field || null,
      legend: categoricalLegend
        ? {
            ...categoricalLegend,
            appliesToFolder: folder || null,
            appliesToGeometryRole: geometryRole,
          }
        : null,
      symbology: categoricalLegend
        ? "legend"
        : singleStyle
          ? "file-style"
          : "file-style-mixed",
      note: categoricalLegend ? "Leyenda inferida dentro de la carpeta KML." : "Simbologia definida por el archivo.",
      provenance: {
        scope: folder ? "kml-folder" : "kml-document",
        confidence: categoricalLegend ? "high" : singleStyle ? "style-only" : "medium",
      },
    };
  });
}

export function readFolderAwareLegendPlacemarks(kmlText) {
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
    const description = decodeCdata(readXmlTagBody(body, "description"));
    const styleUrl = readXmlTag(body, "styleUrl");
    const geometryType = getKmlPlacemarkGeometryType(body);
    placemarks.push({
      folder: [...folderStack].reverse().find(Boolean) || null,
      name: decodeXmlText(readXmlTag(body, "name")),
      styleUrl,
      styleId: stripStyleUrlHash(styleUrl),
      attributes: parseDescriptionTableAttributes(description),
      geometryType,
      geometryRole: inferGeometryRole([...folderStack].reverse().find(Boolean), geometryType),
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

export function inferGeometryRole(folder, geometryType) {
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

function stripStyleUrlHash(value) {
  return String(value || "").replace(/^#/u, "") || null;
}

function buildIntensityPolygonLegend(placemarks, styles) {
  const classes = new Map();

  for (const placemark of placemarks) {
    const style = placemark.styleUrl ? styles.get(placemark.styleUrl) : null;
    const fill = style?.fill || null;
    const label = normalizeLegendIntensity(placemark.attributes.Intensidad || placemark.attributes.Intensid_1 || placemark.attributes.Intensidad_1);
    if (!label || !fill) continue;
    const key = normalizeLegendKey(label);
    if (!classes.has(key)) {
      classes.set(key, {
        label,
        value: label,
        color: fill,
        outlineColor: style?.stroke || "#f0f0f0",
        order: getLegendOrder(label),
        count: 0,
      });
    }
    classes.get(key).count += 1;
  }

  const ordered = [...classes.values()].sort((a, b) => a.order - b.order);
  return ordered.length
    ? {
        type: "categorical",
        field: "Intensidad",
        styleField: "Intensidad",
        classes: ordered,
      }
    : null;
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

  const exactCandidates = [...candidates.entries()]
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
    .sort((a, b) => scoreLegendField(b.field) - scoreLegendField(a.field));

  const selected = exactCandidates[0];
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
    if (!bounds) errors.push(`GroundOverlay ${name} no contiene LatLonBox válido.`);
    if (bounds && rotation !== 0) {
      errors.push(`GroundOverlay ${name} usa rotation=${rotation}; la rotación distinta de cero aún no se representa con precisión.`);
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

function extractScale(text) {
  const match = String(text || "").match(/Escala\s*:?\s*(1\s*:\s*[\d,.]+)/iu);
  return match?.[1]?.replace(/\s+/gu, "") || null;
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
    const scale = iconStyle ? toFiniteNumber(readXmlTag(iconStyle, "scale")) : null;
    const iconEntry = iconHref ? resolveKmzHrefEntry(options.entries || [], options.kmlEntryName || "", iconHref) : null;
    const iconColor = icon?.opacity > 0 ? icon.hex : detectDominantIconColor(options.archivePath, iconEntry);
    styles.set(`#${id}`, {
      id,
      fill: fill?.hex || null,
      stroke: stroke?.hex || null,
      icon: iconColor,
      iconHref,
      scale,
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

function detectDominantIconColor(archivePath, entry) {
  if (!archivePath || !entry || getExtension(entry.name) !== "png") return null;
  try {
    const png = decodeSimplePng(readZipEntryBuffer(archivePath, entry), { maxWidth: 512, maxHeight: 512, maxBytes: 1024 * 1024 });
    const colors = new Map();
    png?.pixels?.forEach((pixel) => {
      if (pixel.a < 16) return;
      const key = `#${toHexByte(pixel.r)}${toHexByte(pixel.g)}${toHexByte(pixel.b)}`;
      colors.set(key, (colors.get(key) || 0) + 1);
    });
    return [...colors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  } catch (_error) {
    return null;
  }
}

function parseDescriptionTableAttributes(description) {
  const html = decodeCdata(description);
  const attributes = {};
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/giu;
  let rowMatch = null;
  while ((rowMatch = rowRegex.exec(html))) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/giu)]
      .map((cell) => normalizeText(stripHtml(cell[1])));
    if (cells.length >= 2 && cells[0] && cells[1]) {
      attributes[cells[0].replace(/:$/u, "").trim()] = cells[1];
    }
  }
  return attributes;
}

function normalizeLegendIntensity(value) {
  const normalized = normalizeLegendKey(value).replace(/\s+/gu, " ").trim();
  const labels = {
    "muy alto": "Muy alto",
    alto: "Alto",
    medio: "Medio",
    bajo: "Bajo",
    "muy bajo": "Muy bajo",
  };
  return labels[normalized] || normalizeText(value);
}

function getLegendOrder(label) {
  const orders = new Map([
    ["muy alto", 1],
    ["alto", 2],
    ["medio", 3],
    ["bajo", 4],
    ["muy bajo", 5],
  ]);
  return orders.get(normalizeLegendKey(label).replace(/\s+/gu, " ").trim()) || 100;
}

function normalizeLegendKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase();
}

function decodeSimplePng(buffer, limits) {
  if (!Buffer.isBuffer(buffer) || buffer.length > limits.maxBytes) return null;
  if (buffer.length < 33 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = null;
  const idat = [];

  while (offset < buffer.length - 12) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) return null;
    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      const bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      if (bitDepth !== 8 || ![2, 6].includes(colorType) || width > limits.maxWidth || height > limits.maxHeight) return null;
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!width || !height || !idat.length) return null;
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const pixels = [];
  let inputOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const row = Buffer.from(inflated.subarray(inputOffset, inputOffset + stride));
    inputOffset += stride;
    unfilterPngRow(row, previous, channels, filter);
    for (let x = 0; x < width; x += 1) {
      const index = x * channels;
      pixels.push({
        r: row[index],
        g: row[index + 1],
        b: row[index + 2],
        a: channels === 4 ? row[index + 3] : 255,
      });
    }
    previous = row;
  }

  return { width, height, pixels };
}

function unfilterPngRow(row, previous, channels, filter) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= channels ? row[index - channels] : 0;
    const up = previous[index] || 0;
    const upLeft = index >= channels ? previous[index - channels] || 0 : 0;
    if (filter === 1) row[index] = (row[index] + left) & 0xff;
    else if (filter === 2) row[index] = (row[index] + up) & 0xff;
    else if (filter === 3) row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) row[index] = (row[index] + paethPredictor(left, up, upLeft)) & 0xff;
  }
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function toHexByte(value) {
  return value.toString(16).padStart(2, "0");
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
