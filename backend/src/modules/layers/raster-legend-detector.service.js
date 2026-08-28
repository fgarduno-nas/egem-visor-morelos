import fs from "node:fs";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { performance } from "node:perf_hooks";

export const RASTER_LEGEND_DETECTOR_VERSION = "1.0.0";

export const RASTER_LEGEND_LIMITS = {
  maxWidth: 12000,
  maxHeight: 12000,
  maxPixels: 100_000_000,
  maxInflatedBytes: 320 * 1024 * 1024,
  maxOpaqueColors: 64,
  maxSamplePixels: 1_200_000,
  alphaTransparentThreshold: 8,
};

export const ORDINAL_FIVE_LEVEL_PROFILE = {
  id: "egem-ordinal-five-level",
  colors: ["#006100", "#7aab00", "#ffff00", "#ff9900", "#ff2200"],
  labels: {
    feminine: ["Muy baja", "Baja", "Media", "Alta", "Muy alta"],
    masculine: ["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"],
  },
};

const FEMININE_CONCEPTS = new Set([
  "susceptibilidad",
  "vulnerabilidad",
  "intensidad",
  "inestabilidad",
  "amenaza",
  "probabilidad",
]);

const MASCULINE_CONCEPTS = new Set([
  "peligro",
  "riesgo",
  "indice",
  "grado",
  "nivel",
]);

export async function detectRasterLegendForGroundOverlays(overlays = [], context = {}) {
  const startedAt = performance.now();
  const diagnostics = {
    detectorVersion: RASTER_LEGEND_DETECTOR_VERSION,
    source: "auto-detected",
    confidence: "low",
    profile: null,
    overlays: [],
    warnings: [],
    timingsMs: {},
    analyzedAt: new Date().toISOString(),
  };

  if (!Array.isArray(overlays) || !overlays.length) {
    diagnostics.warnings.push("No hay GroundOverlay para analizar.");
    diagnostics.timingsMs.total = elapsedMs(startedAt);
    return { rasterLegend: null, diagnostics };
  }

  const analyses = await Promise.all(overlays.map((overlay) => analyzeOverlaySafely(overlay)));
  diagnostics.overlays = analyses.map((item) => item.diagnostics);
  const validAnalyses = analyses.filter((item) => item.analysis?.confidence === "high");

  if (validAnalyses.length !== overlays.length) {
    diagnostics.warnings.push("Uno o mas overlays no alcanzaron confianza alta.");
    diagnostics.timingsMs.total = elapsedMs(startedAt);
    return { rasterLegend: null, diagnostics };
  }

  const profileIds = new Set(validAnalyses.map((item) => item.analysis.profile));
  if (profileIds.size !== 1) {
    diagnostics.warnings.push("Los overlays tienen perfiles de paleta distintos.");
    diagnostics.timingsMs.total = elapsedMs(startedAt);
    return { rasterLegend: null, diagnostics };
  }

  const concept = inferRasterLegendConcept(context);
  diagnostics.concept = concept;
  if (!concept?.gender) {
    diagnostics.warnings.push("No se pudo inferir genero semantico con suficiente certeza.");
    diagnostics.timingsMs.total = elapsedMs(startedAt);
    return { rasterLegend: null, diagnostics };
  }

  const labels = ORDINAL_FIVE_LEVEL_PROFILE.labels[concept.gender];
  const classes = ORDINAL_FIVE_LEVEL_PROFILE.colors.map((color, index) => ({
    label: labels[index],
    color,
    value: String(index + 1),
    order: index + 1,
  }));

  diagnostics.confidence = "high";
  diagnostics.profile = ORDINAL_FIVE_LEVEL_PROFILE.id;
  diagnostics.timingsMs.total = elapsedMs(startedAt);

  return {
    rasterLegend: {
      type: "raster",
      field: null,
      title: null,
      source: "auto-detected",
      confidence: "high",
      profile: ORDINAL_FIVE_LEVEL_PROFILE.id,
      detectorVersion: RASTER_LEGEND_DETECTOR_VERSION,
      classes,
    },
    diagnostics,
  };
}

export async function analyzeRasterLegendImage(filePath, options = {}) {
  const startedAt = performance.now();
  const readStartedAt = performance.now();
  const buffer = fs.readFileSync(filePath);
  const readMs = elapsedMs(readStartedAt);
  const parsed = await parsePngColorUsage(buffer, options);
  const detectionStartedAt = performance.now();
  const detectedColors = parsed.opaqueColors.map((item) => item.color);
  const profile = recognizeOrdinalFiveLevelProfile(parsed);
  const detectionMs = elapsedMs(detectionStartedAt);

  return {
    filePath,
    mimeType: "image/png",
    width: parsed.width,
    height: parsed.height,
    pixelCount: parsed.pixelCount,
    colorType: parsed.colorType,
    bitDepth: parsed.bitDepth,
    opaqueColors: parsed.opaqueColors,
    transparentPixelCount: parsed.transparentPixelCount,
    sampledPixelCount: parsed.sampledPixelCount,
    residualOpaquePixelCount: parsed.residualOpaquePixelCount,
    profile: profile ? ORDINAL_FIVE_LEVEL_PROFILE.id : null,
    confidence: profile ? "high" : "low",
    warnings: parsed.warnings,
    timingsMs: {
      read: readMs,
      sampling: parsed.timingsMs.sampling,
      detection: detectionMs,
      total: elapsedMs(startedAt),
    },
    approxMemoryBytes: parsed.approxMemoryBytes,
  };
}

export function inferRasterLegendConcept(context = {}) {
  const candidates = [
    context.rpvea,
    context.legendField,
    context.metadata?.R_P_V_E_A,
    context.metadata?.r_p_v_e_a,
    context.metadata?.concept,
    context.metadata?.field,
    context.title,
    context.name,
    context.fileName,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const normalized = normalizeConceptText(candidate);
    const tokens = normalized.split(/\s+/u).filter(Boolean);
    const feminine = tokens.find((token) => FEMININE_CONCEPTS.has(token));
    if (feminine) return { concept: titleCaseConcept(feminine), gender: "feminine", source: candidate };
    const masculine = tokens.find((token) => MASCULINE_CONCEPTS.has(token));
    if (masculine) return { concept: titleCaseConcept(masculine), gender: "masculine", source: candidate };
  }

  return { concept: null, gender: null, source: null };
}

async function analyzeOverlaySafely(overlay) {
  try {
    const analysis = await analyzeRasterLegendImage(overlay.imagePath);
    return {
      analysis,
      diagnostics: summarizeImageAnalysis(overlay, analysis),
    };
  } catch (error) {
    return {
      analysis: null,
      diagnostics: {
        overlayId: overlay.id,
        name: overlay.name,
        sourcePath: overlay.sourcePath,
        confidence: "low",
        errors: [error.message],
      },
    };
  }
}

function summarizeImageAnalysis(overlay, analysis) {
  return {
    overlayId: overlay.id,
    name: overlay.name,
    sourcePath: overlay.sourcePath,
    imageName: overlay.sourcePath,
    dimensions: { width: analysis.width, height: analysis.height },
    colorType: analysis.colorType,
    bitDepth: analysis.bitDepth,
    opaqueColors: analysis.opaqueColors,
    transparentPixelCount: analysis.transparentPixelCount,
    sampledPixelCount: analysis.sampledPixelCount,
    residualOpaquePixelCount: analysis.residualOpaquePixelCount,
    profile: analysis.profile,
    confidence: analysis.confidence,
    warnings: analysis.warnings,
    timingsMs: analysis.timingsMs,
    approxMemoryBytes: analysis.approxMemoryBytes,
  };
}

function recognizeOrdinalFiveLevelProfile(analysis) {
  if (analysis.warnings.length) return false;
  const expected = new Set(ORDINAL_FIVE_LEVEL_PROFILE.colors);
  const detected = new Set(analysis.opaqueColors.map((item) => item.color));
  if (detected.size !== expected.size) return false;
  for (const color of expected) {
    if (!detected.has(color)) return false;
  }
  return analysis.residualOpaquePixelCount === 0;
}

async function parsePngColorUsage(buffer, options = {}) {
  const chunks = readPngChunks(buffer);
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR")?.data;
  if (!ihdr || ihdr.length !== 13) throw new Error("PNG sin IHDR valido.");

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  validateImageDimensions(width, height, options.limits || RASTER_LEGEND_LIMITS);

  if (bitDepth !== 8) return unsupportedPngAnalysis(width, height, bitDepth, colorType, "Solo se analiza automaticamente PNG con bitDepth 8.");
  if (![2, 3, 6].includes(colorType)) return unsupportedPngAnalysis(width, height, bitDepth, colorType, "Tipo de color PNG no soportado para deteccion automatica.");

  const paletteChunk = chunks.find((chunk) => chunk.type === "PLTE")?.data;
  if (colorType === 3 && (!paletteChunk || paletteChunk.length % 3 !== 0)) throw new Error("PNG paletizado sin PLTE valido.");
  const transparencyChunk = chunks.find((chunk) => chunk.type === "tRNS")?.data || Buffer.alloc(0);
  const idat = Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data));
  if (!idat.length) throw new Error("PNG sin datos IDAT.");

  const palette = colorType === 3 ? readPalette(paletteChunk, transparencyChunk) : [];
  const samplingStartedAt = performance.now();
  const sampleStep = getSampleStep(width, height, options.limits || RASTER_LEGEND_LIMITS);
  const usage = await countPngColorsFromInflatedStream({
    idat,
    width,
    height,
    colorType,
    palette,
    sampleStep,
    limits: options.limits || RASTER_LEGEND_LIMITS,
  });
  const opaqueColors = [...usage.opaque.entries()]
    .map(([color, count]) => ({
      color,
      count,
      ratio: Number((count / Math.max(1, usage.opaquePixelCount)).toFixed(6)),
    }))
    .sort((a, b) => ORDINAL_FIVE_LEVEL_PROFILE.colors.indexOf(a.color) - ORDINAL_FIVE_LEVEL_PROFILE.colors.indexOf(b.color));
  const expected = new Set(ORDINAL_FIVE_LEVEL_PROFILE.colors);
  const residualOpaquePixelCount = opaqueColors
    .filter((item) => !expected.has(item.color))
    .reduce((sum, item) => sum + item.count, 0);
  const warnings = [];
  if (opaqueColors.length > RASTER_LEGEND_LIMITS.maxOpaqueColors) warnings.push("Demasiados colores opacos para una leyenda categorica segura.");
  if (residualOpaquePixelCount > 0) warnings.push("Existen colores opacos fuera del perfil conocido.");

  return {
    width,
    height,
    pixelCount: width * height,
    colorType,
    bitDepth,
    opaqueColors,
    transparentPixelCount: usage.transparentPixelCount,
    sampledPixelCount: usage.sampledPixelCount,
    residualOpaquePixelCount,
    warnings,
    timingsMs: { sampling: elapsedMs(samplingStartedAt) },
    approxMemoryBytes: buffer.length + idat.length + usage.maxBufferedBytes,
  };
}

function unsupportedPngAnalysis(width, height, bitDepth, colorType, reason) {
  return {
    width,
    height,
    pixelCount: width * height,
    colorType,
    bitDepth,
    opaqueColors: [],
    transparentPixelCount: 0,
    sampledPixelCount: 0,
    residualOpaquePixelCount: 0,
    warnings: [reason],
    timingsMs: { sampling: 0 },
    approxMemoryBytes: 0,
  };
}

function readPngChunks(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error("La imagen no tiene encabezado PNG valido.");
  }
  const chunks = [];
  let offset = 8;
  let hasIhdr = false;
  let hasIend = false;
  let hasPlte = false;
  let hasTrns = false;
  let seenIdat = false;
  let idatClosed = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error("PNG truncado o corrupto.");
    validatePngChunkOrder(type, chunks.length, {
      hasIhdr,
      hasIend,
      hasPlte,
      hasTrns,
      seenIdat,
      idatClosed,
    });
    chunks.push({ type, data: buffer.subarray(dataStart, dataEnd) });
    if (type === "IHDR") hasIhdr = true;
    if (type === "PLTE") hasPlte = true;
    if (type === "tRNS") hasTrns = true;
    if (type === "IDAT") seenIdat = true;
    if (seenIdat && type !== "IDAT") idatClosed = true;
    if (type === "IEND") hasIend = true;
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }
  if (!hasIend) throw new Error("PNG sin chunk IEND.");
  return chunks;
}

function validatePngChunkOrder(type, index, state) {
  if (state.hasIend) throw new Error("PNG contiene datos despues de IEND.");
  if (index === 0 && type !== "IHDR") throw new Error("PNG debe iniciar con IHDR.");
  if (type === "IHDR" && state.hasIhdr) throw new Error("PNG contiene IHDR duplicado.");
  if (type !== "IHDR" && !state.hasIhdr) throw new Error("PNG contiene chunks antes de IHDR.");
  if (type === "PLTE" && state.hasPlte) throw new Error("PNG contiene PLTE duplicado.");
  if (type === "tRNS" && state.hasTrns) throw new Error("PNG contiene tRNS duplicado.");
  if (type === "tRNS" && state.seenIdat) throw new Error("PNG contiene tRNS despues de IDAT.");
  if (type === "PLTE" && state.seenIdat) throw new Error("PNG contiene PLTE despues de IDAT.");
  if (type === "IDAT" && state.idatClosed) throw new Error("PNG contiene IDAT no contiguos.");
  if (type === "IEND" && !state.hasIhdr) throw new Error("PNG finaliza sin IHDR.");
}

function validateImageDimensions(width, height, limits) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Dimensiones PNG invalidas.");
  }
  if (width > limits.maxWidth || height > limits.maxHeight || width * height > limits.maxPixels) {
    throw new Error("Dimensiones PNG exceden los limites de analisis.");
  }
}

function readPalette(paletteChunk, transparencyChunk) {
  const palette = [];
  for (let offset = 0; offset < paletteChunk.length; offset += 3) {
    const index = offset / 3;
    const alpha = transparencyChunk[index] ?? 255;
    palette.push({
      color: `#${paletteChunk[offset].toString(16).padStart(2, "0")}${paletteChunk[offset + 1].toString(16).padStart(2, "0")}${paletteChunk[offset + 2].toString(16).padStart(2, "0")}`,
      alpha,
    });
  }
  return palette;
}

async function countPngColorsFromInflatedStream({ idat, width, height, colorType, palette, sampleStep, limits }) {
  const bytesPerPixel = getBytesPerPixel(colorType);
  const stride = width * bytesPerPixel;
  const rowLength = stride + 1;
  const expectedBytes = rowLength * height;
  if (expectedBytes > limits.maxInflatedBytes) {
    throw new Error("PNG excede el limite de bytes inflados para analisis.");
  }

  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  const opaque = new Map();
  let transparentPixelCount = 0;
  let opaquePixelCount = 0;
  let inflatedBytes = 0;
  let row = 0;
  let carry = Buffer.alloc(0);
  let maxBufferedBytes = previous.length + current.length;
  const inflate = Readable.from([idat]).pipe(zlib.createInflate());

  for await (const chunk of inflate) {
    inflatedBytes += chunk.length;
    if (inflatedBytes > limits.maxInflatedBytes) {
      throw new Error("PNG excede el limite de bytes inflados para analisis.");
    }
    carry = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    maxBufferedBytes = Math.max(maxBufferedBytes, carry.length + previous.length + current.length);
    while (carry.length >= rowLength && row < height) {
      const filter = carry[0];
      carry.copy(current, 0, 1, rowLength);
      carry = carry.subarray(rowLength);
      unfilterPngRow(current, previous, filter, bytesPerPixel);
      if (row % sampleStep === 0) {
        const counts = countDecodedRowColors(current, width, colorType, palette, sampleStep);
        transparentPixelCount += counts.transparentPixelCount;
        opaquePixelCount += counts.opaquePixelCount;
        counts.opaque.forEach((count, color) => {
          opaque.set(color, (opaque.get(color) || 0) + count);
        });
      }
      current.copy(previous);
      row += 1;
    }
  }

  if (row !== height) throw new Error("PNG inflado incompleto.");
  return {
    opaque,
    opaquePixelCount,
    transparentPixelCount,
    sampledPixelCount: opaquePixelCount + transparentPixelCount,
    maxBufferedBytes,
  };
}

function countDecodedRowColors(row, width, colorType, palette, sampleStep) {
  const opaque = new Map();
  let transparentPixelCount = 0;
  let opaquePixelCount = 0;
  const bytesPerPixel = getBytesPerPixel(colorType);

  for (let column = 0; column < width; column += sampleStep) {
    const color = readDecodedPixel(row, column * bytesPerPixel, colorType, palette);
    if (!color) continue;
    if (color.alpha <= RASTER_LEGEND_LIMITS.alphaTransparentThreshold) {
      transparentPixelCount += 1;
      continue;
    }
    opaquePixelCount += 1;
    opaque.set(color.hex, (opaque.get(color.hex) || 0) + 1);
  }

  return { opaque, opaquePixelCount, transparentPixelCount };
}

function getSampleStep(width, height, limits) {
  const pixelCount = width * height;
  const maxSamplePixels = limits.maxSamplePixels || RASTER_LEGEND_LIMITS.maxSamplePixels;
  if (pixelCount <= maxSamplePixels) return 1;
  return Math.ceil(Math.sqrt(pixelCount / maxSamplePixels));
}

function readDecodedPixel(row, offset, colorType, palette) {
  if (colorType === 3) {
    const paletteEntry = palette[row[offset]];
    return paletteEntry ? { hex: paletteEntry.color, alpha: paletteEntry.alpha } : null;
  }
  const red = row[offset];
  const green = row[offset + 1];
  const blue = row[offset + 2];
  const alpha = colorType === 6 ? row[offset + 3] : 255;
  return {
    hex: `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`,
    alpha,
  };
}

function getBytesPerPixel(colorType) {
  if (colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 6) return 4;
  throw new Error(`Tipo de color PNG no soportado: ${colorType}.`);
}

function unfilterPngRow(row, previous, filter, bytesPerPixel) {
  if (filter === 0) return;
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previous[index] || 0;
    const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] || 0 : 0;
    if (filter === 1) row[index] = (row[index] + left) & 0xff;
    else if (filter === 2) row[index] = (row[index] + up) & 0xff;
    else if (filter === 3) row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) row[index] = (row[index] + paethPredictor(left, up, upperLeft)) & 0xff;
    else throw new Error(`Filtro PNG no soportado: ${filter}.`);
  }
}

function paethPredictor(left, up, upperLeft) {
  const p = left + up - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upperLeft;
}

function normalizeConceptText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleCaseConcept(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : null;
}

function elapsedMs(startedAt) {
  return Number((performance.now() - startedAt).toFixed(3));
}
