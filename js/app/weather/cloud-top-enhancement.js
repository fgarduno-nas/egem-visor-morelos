export const GOES_IR_ENHANCEMENT_PROTOCOL = "goes-enhanced";
export const GOES_IR_RAMP_VERSION = "thermal-ir-v2";

export const GOES_IR_ENHANCEMENT_METADATA = {
  sourceLayer: "satellite:goes_longwave_imagery",
  sourceStyle: "goes-lir",
  sourceBand: "Band1",
  documentedRange: [0, 255],
  sourceColorMap: [
    { quantity: 0, color: "#ffffff", label: "0" },
    { quantity: 255, color: "#000000", label: "255" },
  ],
  interpretation:
    "Realce visual aplicado al rango Band1 0-255 publicado por el SLD oficial de nowCOAST. El PNG oficial está renderizado en escala invertida (0 blanco, 255 negro). La transparencia enfatiza la señal térmica más fría/intensa, pero no es una máscara oficial de nube ni representa lluvia, peligro, radiación UV o umbrales en grados Celsius.",
};

export const GOES_IR_COLOR_RAMP = [
  { quantity: 0, color: "#000000", opacity: 0, label: "Menor señal" },
  { quantity: 120, color: "#6458d6", opacity: 0 },
  { quantity: 140, color: "#22d2ef", opacity: 0.26 },
  { quantity: 165, color: "#43d46d", opacity: 0.5 },
  { quantity: 195, color: "#ffe95e", opacity: 0.68 },
  { quantity: 225, color: "#ff8f1f", opacity: 0.82 },
  { quantity: 255, color: "#ff2433", opacity: 0.92, label: "Mayor señal IR" },
];

const DEFAULT_VISIBLE_PIXEL_MIN_PERCENT = 0.5;

export function buildEnhancedWmsTileUrl(wmsTileUrl) {
  const parsed = new URL(wmsTileUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("La tesela GOES IR realzada debe originarse en HTTPS.");
  }
  return `${GOES_IR_ENHANCEMENT_PROTOCOL}://${parsed.host}${parsed.pathname}${parsed.search}`;
}

export function decodeEnhancedTileUrl(protocolUrl) {
  const prefix = `${GOES_IR_ENHANCEMENT_PROTOCOL}://`;
  if (!String(protocolUrl || "").startsWith(prefix)) {
    throw new Error("URL de protocolo GOES IR invalida.");
  }
  return `https://${String(protocolUrl).slice(prefix.length)}`;
}

export function enhanceInfraredImageData(imageData, options = {}) {
  const ramp = validateColorRamp(options.ramp || GOES_IR_COLOR_RAMP);
  const output = new Uint8ClampedArray(imageData.data.length);
  const distribution = getInfraredBandDistribution(imageData);
  const threshold = Number.isFinite(options.signalThreshold)
    ? Number(options.signalThreshold)
    : Math.max(
        Number(options.minimumSignalThreshold || 90),
        percentile(distribution.values, Number(options.visiblePercentile || 85))
      );
  const upper = Math.max(
    threshold + 1,
    Number.isFinite(options.signalUpper)
      ? Number(options.signalUpper)
      : percentile(distribution.values, Number(options.upperPercentile || 99))
  );

  for (let index = 0; index < imageData.data.length; index += 4) {
    const sourceAlpha = imageData.data[index + 3];
    if (sourceAlpha === 0) {
      output[index + 3] = 0;
      continue;
    }

    const value = getBandValueFromRenderedPixel(
      imageData.data[index],
      imageData.data[index + 1],
      imageData.data[index + 2]
    );
    if (value <= threshold) {
      output[index + 3] = 0;
      continue;
    }
    const normalizedValue = 120 + ((value - threshold) / (upper - threshold)) * 135;
    const color = interpolateRampColor(normalizedValue, ramp);
    output[index] = color.r;
    output[index + 1] = color.g;
    output[index + 2] = color.b;
    output[index + 3] = Math.round(color.opacity * sourceAlpha);
  }

  return {
    data: output,
    width: imageData.width,
    height: imageData.height,
    threshold,
    upper,
  };
}

export function getBandValueFromRenderedPixel(red, green, blue) {
  const renderedGray = Math.round((Number(red) + Number(green) + Number(blue)) / 3);
  return clampQuantity(255 - renderedGray);
}

export function interpolateRampColor(value, ramp = GOES_IR_COLOR_RAMP) {
  const quantity = clampQuantity(value);
  const stops = validateColorRamp(ramp);
  if (quantity <= stops[0].quantity) return { ...stops[0] };
  if (quantity >= stops[stops.length - 1].quantity) return { ...stops[stops.length - 1] };

  for (let index = 1; index < stops.length; index += 1) {
    const upper = stops[index];
    const lower = stops[index - 1];
    if (quantity > upper.quantity) continue;
    const span = upper.quantity - lower.quantity || 1;
    const t = (quantity - lower.quantity) / span;
    return {
      r: Math.round(lerp(lower.r, upper.r, t)),
      g: Math.round(lerp(lower.g, upper.g, t)),
      b: Math.round(lerp(lower.b, upper.b, t)),
      opacity: lerp(lower.opacity, upper.opacity, t),
    };
  }
  return { ...stops[stops.length - 1] };
}

export function validateColorRamp(ramp) {
  const stops = (Array.isArray(ramp) ? ramp : [])
    .map((stop) => ({
      ...stop,
      quantity: clampQuantity(stop.quantity),
      ...hexToRgb(stop.color),
      opacity: Math.min(1, Math.max(0, Number(stop.opacity))),
    }))
    .filter((stop) => Number.isFinite(stop.quantity) && Number.isFinite(stop.opacity))
    .sort((a, b) => a.quantity - b.quantity);

  if (stops.length < 2) {
    throw new Error("La rampa GOES IR necesita al menos dos puntos.");
  }
  if (stops[0].quantity !== 0 || stops[stops.length - 1].quantity !== 255) {
    throw new Error("La rampa GOES IR debe cubrir el rango oficial 0-255.");
  }
  return stops;
}

export function createEnhancedTileCache(options = {}) {
  const maxEntries = Math.max(1, Number(options.maxEntries || 96));
  const entries = new Map();
  return {
    get(url) {
      return entries.get(url) || null;
    },
    set(url, value) {
      if (entries.has(url)) entries.delete(url);
      entries.set(url, value);
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }
    },
    has(url) {
      return entries.has(url);
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

export function createGoesIrFrameRenderer(options = {}) {
  const cache = createEnhancedFrameCache({ maxEntries: options.maxEntries || 96 });
  const inFlight = new Map();
  const fetchFn = options.fetchFn || globalThis.fetch?.bind(globalThis);
  const createObjectUrl = options.createObjectUrl || globalThis.URL?.createObjectURL?.bind(globalThis.URL);
  const revokeObjectUrl = options.revokeObjectUrl || globalThis.URL?.revokeObjectURL?.bind(globalThis.URL);
  const renderFn = options.renderFn || enhancePngBlobWithDiagnostics;
  const persistentCache = options.persistentCache || createPersistentFrameCache({
    enabled: options.enablePersistentCache !== false,
    cacheName: options.cacheName || "egem-goes-ir-frames-v1",
    ttlMs: options.persistentTtlMs || 3 * 60 * 60 * 1000,
    maxEntries: options.persistentMaxEntries || 80,
  });
  const minVisiblePercent = Number.isFinite(options.minVisiblePercent)
    ? options.minVisiblePercent
    : DEFAULT_VISIBLE_PIXEL_MIN_PERCENT;
  const stats = {
    networkRequests: 0,
    cacheHits: 0,
    dedupedRequests: 0,
    renderedFrames: 0,
    rejectedFrames: 0,
  };

  async function loadFrame(frame, requestOptions = {}) {
    const sourceUrl = frame?.sourceUrl || frame?.url;
    const key = frame?.cacheKey || sourceUrl;
    if (!sourceUrl || !key) {
      throw new Error("El cuadro GOES IR no incluye URL fuente.");
    }
    const cached = cache.get(key);
    if (cached) {
      stats.cacheHits += 1;
      return { ...frame, ...cached, fromCache: true };
    }
    const persistent = await persistentCache.get(key);
    if (persistent) {
      stats.cacheHits += 1;
      cache.set(key, persistent);
      return { ...frame, ...persistent, fromCache: true, fromPersistentCache: true };
    }
    if (inFlight.has(key)) {
      stats.dedupedRequests += 1;
      return inFlight.get(key);
    }

    const task = fetchAndRenderFrame(frame, { signal: requestOptions.signal })
      .then((rendered) => {
        cache.set(key, rendered);
        persistentCache.set(key, rendered).catch((error) => {
          console.warn("No se pudo persistir cuadro GOES IR:", error);
        });
        return { ...frame, ...rendered, fromCache: false };
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, task);
    return task;
  }

  async function fetchAndRenderFrame(frame, requestOptions = {}) {
    if (typeof fetchFn !== "function") {
      throw new Error("No hay fetch disponible para cargar GOES IR.");
    }
    stats.networkRequests += 1;
    const response = await fetchFn(frame.sourceUrl || frame.url, { signal: requestOptions.signal, cache: "force-cache" });
    await validateImageResponse(response);
    const sourceBlob = await response.blob();
    const rendered = await renderFn(sourceBlob, options);
    const visiblePercent = rendered.diagnostics?.enhancedVisiblePercent || 0;
    if (visiblePercent < minVisiblePercent) {
      stats.rejectedFrames += 1;
      throw new Error(`Cuadro GOES IR sin pixeles visibles suficientes (${visiblePercent.toFixed(2)}%).`);
    }
    if (typeof createObjectUrl !== "function") {
      throw new Error("No hay URL.createObjectURL disponible para el cuadro GOES IR.");
    }
    const url = createObjectUrl(rendered.blob);
    stats.renderedFrames += 1;
    return {
      url,
      sourceUrl: frame.sourceUrl || frame.url,
      bounds: frame.bounds,
      width: rendered.width,
      height: rendered.height,
      diagnostics: rendered.diagnostics,
    };
  }

  return {
    loadFrame,
    preloadFrame(frame, requestOptions = {}) {
      return loadFrame(frame, requestOptions).catch((error) => {
        console.warn("No se pudo precargar cuadro GOES IR:", error);
        return null;
      });
    },
    getStats() {
      return {
        ...stats,
        cacheSize: cache.size(),
        inFlight: inFlight.size,
      };
    },
    clear() {
      cache.values().forEach((item) => {
        if (item?.url && typeof revokeObjectUrl === "function") revokeObjectUrl(item.url);
      });
      cache.clear();
      inFlight.clear();
    },
  };
}

export function buildPersistentFrameCacheKey(key) {
  return `https://egem.local/goes-ir-cache/${GOES_IR_RAMP_VERSION}/${encodeURIComponent(key)}`;
}

export function createPersistentFrameCache(options = {}) {
  const enabled = options.enabled !== false;
  const cacheName = options.cacheName || "egem-goes-ir-frames-v1";
  const ttlMs = Math.max(1, Number(options.ttlMs || 3 * 60 * 60 * 1000));
  const maxEntries = Math.max(1, Number(options.maxEntries || 80));
  const storageKey = `${cacheName}:index`;
  const cachesApi = globalThis.caches;
  const storage = globalThis.localStorage;
  if (!enabled || !cachesApi || !storage) {
    return {
      async get() { return null; },
      async set() {},
      async prune() {},
    };
  }

  async function readIndex() {
    try {
      return JSON.parse(storage.getItem(storageKey) || "[]").filter((entry) => entry?.key && Number.isFinite(entry.createdAt));
    } catch {
      return [];
    }
  }

  function writeIndex(index) {
    try {
      storage.setItem(storageKey, JSON.stringify(index.slice(-maxEntries)));
    } catch {}
  }

  return {
    async get(key) {
      const now = Date.now();
      const index = await readIndex();
      const entry = index.find((item) => item.key === key);
      if (!entry || now - entry.createdAt > ttlMs) return null;
      const cacheStore = await cachesApi.open(cacheName);
      const response = await cacheStore.match(buildPersistentFrameCacheKey(key));
      if (!response) return null;
      const blob = await response.blob();
      const sourceUrl = response.headers.get("x-egem-source-url") || null;
      return {
        url: URL.createObjectURL(blob),
        ...(sourceUrl ? { sourceUrl } : {}),
        width: Number(response.headers.get("x-egem-width")) || undefined,
        height: Number(response.headers.get("x-egem-height")) || undefined,
        diagnostics: parseDiagnosticsHeader(response.headers.get("x-egem-diagnostics")),
      };
    },
    async set(key, frame) {
      if (!frame?.url) return;
      const blob = await fetch(frame.url).then((response) => response.blob()).catch(() => null);
      if (!blob) return;
      const cacheStore = await cachesApi.open(cacheName);
      await cacheStore.put(buildPersistentFrameCacheKey(key), new Response(blob, {
        headers: {
          "Content-Type": "image/png",
          "x-egem-created-at": String(Date.now()),
          "x-egem-source-url": frame.sourceUrl || "",
          "x-egem-width": String(frame.width || ""),
          "x-egem-height": String(frame.height || ""),
          "x-egem-diagnostics": JSON.stringify(frame.diagnostics || {}),
        },
      }));
      const index = (await readIndex()).filter((entry) => entry.key !== key);
      index.push({ key, createdAt: Date.now() });
      writeIndex(index);
      await this.prune();
    },
    async prune() {
      const now = Date.now();
      const index = await readIndex();
      const fresh = index.filter((entry) => now - entry.createdAt <= ttlMs).slice(-maxEntries);
      const stale = index.filter((entry) => !fresh.some((item) => item.key === entry.key));
      const cacheStore = await cachesApi.open(cacheName);
      await Promise.all(stale.map((entry) => cacheStore.delete(buildPersistentFrameCacheKey(entry.key))));
      writeIndex(fresh);
    },
  };
}

function parseDiagnosticsHeader(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function createEnhancedFrameCache(options = {}) {
  const maxEntries = Math.max(1, Number(options.maxEntries || 96));
  const entries = new Map();
  return {
    get(key) {
      return entries.get(key) || null;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }
    },
    has(key) {
      return entries.has(key);
    },
    values() {
      return [...entries.values()];
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

export async function validateImageResponse(response) {
  if (!response?.ok) {
    throw new Error(`No se pudo descargar cuadro GOES IR (${response?.status || "sin estado"}).`);
  }
  const contentType = response.headers?.get?.("Content-Type") || response.headers?.get?.("content-type") || "";
  if (!/^image\/png\b/i.test(contentType)) {
    throw new Error(`Respuesta GOES IR invalida: Content-Type ${contentType || "desconocido"}.`);
  }
  return true;
}

export function registerGoesIrEnhancementProtocol(maplibregl, options = {}) {
  if (!maplibregl || typeof maplibregl.addProtocol !== "function") return false;
  const registryKey = "__egemGoesIrEnhancementProtocolRegistered";
  if (globalThis[registryKey]) return true;
  const cache = options.cache || createEnhancedTileCache({ maxEntries: options.maxCacheEntries || 120 });

  maplibregl.addProtocol(GOES_IR_ENHANCEMENT_PROTOCOL, async (request, abortController) => {
    const sourceUrl = decodeEnhancedTileUrl(request.url);
    const cached = cache.get(sourceUrl);
    if (cached) return { data: cached.slice(0) };

    const response = await fetch(sourceUrl, { signal: abortController?.signal });
    if (!response.ok) {
      throw new Error(`No se pudo descargar tesela GOES IR (${response.status}).`);
    }
    const sourceBlob = await response.blob();
    const enhanced = await enhancePngBlob(sourceBlob, options);
    cache.set(sourceUrl, enhanced);
    return { data: enhanced.slice(0) };
  });

  globalThis[registryKey] = true;
  globalThis.__egemGoesIrEnhancementCache = cache;
  return true;
}

async function enhancePngBlob(blob, options = {}) {
  const enhanced = await enhancePngBlobWithDiagnostics(blob, options);
  return enhanced.blob.arrayBuffer();
}

async function enhancePngBlobWithDiagnostics(blob, options = {}) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = createWritableCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const source = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const sourceDiagnostics = analyzeInfraredImageData(source);
    const enhanced = enhanceInfraredImageData(source, options);
    context.putImageData(new ImageData(enhanced.data, enhanced.width, enhanced.height), 0, 0);
    const enhancedDiagnostics = analyzeEnhancedImageData(enhanced);
    const outputBlob = await canvasToPngBlob(canvas);
    return {
      blob: outputBlob,
      width: enhanced.width,
      height: enhanced.height,
      diagnostics: {
        ...sourceDiagnostics,
        ...enhancedDiagnostics,
      },
    };
  } finally {
    bitmap.close?.();
  }
}

export function analyzeInfraredImageData(imageData) {
  const totalPixels = imageData.width * imageData.height;
  let sourceOpaquePixels = 0;
  let minBand = Infinity;
  let maxBand = -Infinity;
  const buckets = [0, 0, 0, 0, 0];
  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3];
    if (alpha === 0) continue;
    sourceOpaquePixels += 1;
    const value = getBandValueFromRenderedPixel(
      imageData.data[index],
      imageData.data[index + 1],
      imageData.data[index + 2]
    );
    minBand = Math.min(minBand, value);
    maxBand = Math.max(maxBand, value);
    buckets[Math.min(4, Math.floor(value / 52))] += 1;
  }
  return {
    totalPixels,
    sourceOpaquePixels,
    minBand: sourceOpaquePixels ? minBand : null,
    maxBand: sourceOpaquePixels ? maxBand : null,
    bandBuckets: buckets,
  };
}

function getInfraredBandDistribution(imageData) {
  const values = [];
  for (let index = 0; index < imageData.data.length; index += 4) {
    if (imageData.data[index + 3] === 0) continue;
    values.push(getBandValueFromRenderedPixel(
      imageData.data[index],
      imageData.data[index + 1],
      imageData.data[index + 2]
    ));
  }
  values.sort((a, b) => a - b);
  return { values };
}

function percentile(values, percent) {
  if (!values.length) return 255;
  const normalized = Math.min(100, Math.max(0, Number(percent)));
  const index = Math.min(values.length - 1, Math.max(0, Math.round((normalized / 100) * (values.length - 1))));
  return values[index];
}

export function analyzeEnhancedImageData(imageData) {
  const totalPixels = imageData.width * imageData.height;
  let enhancedVisiblePixels = 0;
  let transparentPixels = 0;
  const colors = new Set();
  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3];
    if (alpha > 0) {
      enhancedVisiblePixels += 1;
      colors.add(`${imageData.data[index]},${imageData.data[index + 1]},${imageData.data[index + 2]}`);
    } else {
      transparentPixels += 1;
    }
  }
  return {
    enhancedVisiblePixels,
    enhancedVisiblePercent: totalPixels ? (enhancedVisiblePixels / totalPixels) * 100 : 0,
    transparentPixels,
    transparentPercent: totalPixels ? (transparentPixels / totalPixels) * 100 : 100,
    visibleColorCount: colors.size,
    signalThreshold: imageData.threshold ?? null,
    signalUpper: imageData.upper ?? null,
  };
}

function createWritableCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToPngBlob(canvas) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo generar PNG realzado."));
    }, "image/png");
  });
}

function hexToRgb(hex) {
  const normalized = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`Color inválido en rampa GOES IR: ${hex}`);
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function clampQuantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 255;
  return Math.min(255, Math.max(0, numeric));
}

function lerp(start, end, t) {
  return start + (end - start) * t;
}
