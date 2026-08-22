import {
  CLOUD_TOP_STALE_THRESHOLD_MS,
  CLOUD_TOP_WINDOW_HOURS,
  normalizeCloudTopFrames,
} from "./cloud-top-animation.js";
import {
  GOES_IR_ENHANCEMENT_METADATA,
  buildEnhancedWmsTileUrl,
} from "./cloud-top-enhancement.js";

export const CLOUD_TOP_PROVIDER_CONFIG = {
  activeProviderId: "noaa-nowcoast-goes-longwave",
  fallbackProviderId: "local-demo-cloud-top",
  enableDemoFallback: false,
  animationWindowHours: CLOUD_TOP_WINDOW_HOURS,
  frameStepMinutes: 10,
  frameDurationMs: 2000,
  requestTimeoutMs: 12000,
  pollingIntervalMs: 10 * 60 * 1000,
  expectedIntervalMs: 5 * 60 * 1000,
  staleThresholdMs: CLOUD_TOP_STALE_THRESHOLD_MS,
};

const NOWCOAST_WMS_URL = "https://nowcoast.noaa.gov/geoserver/ows";
const NOWCOAST_LAYER = "satellite:goes_longwave_imagery";
const NOWCOAST_ALLOWED_HOSTS = new Set(["nowcoast.noaa.gov"]);
export const NOWCOAST_MORELOS_BOUNDS = [-99.85, 18.02, -98.3, 19.48];
export const NOWCOAST_FRAME_SIZE = 640;

export function createCloudTopProvider(options = {}) {
  const official = createNoaaNowcoastCloudTopProvider(options);
  return {
    ...official,
    fallbackProvider: options.enableDemoFallback ? createDemoCloudTopProvider(options) : null,
  };
}

export function createNoaaNowcoastCloudTopProvider(options = {}) {
  const config = { ...CLOUD_TOP_PROVIDER_CONFIG, ...options };
  return {
    id: "noaa-nowcoast-goes-longwave",
    label: "NOAA nowCOAST / GOES infrarrojo de onda larga",
    shortLabel: "NOAA nowCOAST GOES IR",
    productName: "GOES East & West Satellite Longwave Imagery - enhanced Band1 rendering",
    attribution: "Fuente: NOAA/NOS nowCOAST, NOAA/NESDIS GOES",
    isDemo: false,
    format: "WMS 1.3.0 PNG image frames",
    crs: "EPSG:3857",
    styleName: "goes-lir",
    enhancement: GOES_IR_ENHANCEMENT_METADATA,
    expectedIntervalMs: config.frameStepMinutes * 60 * 1000,
    staleThresholdMs: config.staleThresholdMs,
    pollingIntervalMs: config.pollingIntervalMs,
    async getLatestFrames(requestOptions = {}) {
      const signal = requestOptions.signal;
      const xmlText = await fetchTextWithTimeout(
        `${NOWCOAST_WMS_URL}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`,
        {
          signal,
          timeoutMs: config.requestTimeoutMs,
          allowedHosts: NOWCOAST_ALLOWED_HOSTS,
        }
      );
      const times = extractWmsTimeDimension(xmlText, NOWCOAST_LAYER);
      const frames = normalizeCloudTopFrames(
        times.map((timestamp) => buildNowcoastFrame(timestamp)),
        {
          now: requestOptions.now || Date.now(),
          windowHours: config.animationWindowHours,
        }
      );
      const steppedFrames = selectSteppedFrames(frames, {
        now: requestOptions.now || Date.now(),
        windowHours: config.animationWindowHours,
        stepMinutes: config.frameStepMinutes,
      });
      return {
        providerId: this.id,
        providerLabel: this.label,
        attribution: this.attribution,
        productName: this.productName,
        isDemo: false,
        frames: steppedFrames,
        sourceFrameCount: frames.length,
        frameStepMinutes: config.frameStepMinutes,
        animationWindowHours: config.animationWindowHours,
      };
    },
  };
}

export function selectSteppedFrames(frames, options = {}) {
  const normalized = normalizeCloudTopFrames(frames, {
    now: options.now || Date.now(),
    windowHours: options.windowHours || CLOUD_TOP_WINDOW_HOURS,
  });
  const stepMinutes = Math.max(1, Number(options.stepMinutes || 10));
  if (!normalized.length || stepMinutes <= 5) return normalized;

  const stepMs = stepMinutes * 60 * 1000;
  const latest = normalized[normalized.length - 1];
  const latestTime = Date.parse(latest.timestamp);
  const selected = new Map([[latest.timestamp, latest]]);

  for (let target = latestTime - stepMs; target >= latestTime - (options.windowHours || CLOUD_TOP_WINDOW_HOURS) * 60 * 60 * 1000; target -= stepMs) {
    const closest = findClosestFrame(normalized, target, stepMs / 2);
    if (closest) selected.set(closest.timestamp, closest);
  }

  return [...selected.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function findClosestFrame(frames, targetMs, maxDeltaMs) {
  let best = null;
  let bestDelta = Infinity;
  frames.forEach((frame) => {
    const delta = Math.abs(Date.parse(frame.timestamp) - targetMs);
    if (delta <= maxDeltaMs && delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
  });
  return best;
}

export function createDemoCloudTopProvider(options = {}) {
  const config = { ...CLOUD_TOP_PROVIDER_CONFIG, ...options };
  return {
    id: "local-demo-cloud-top",
    label: "Modo demostrativo local",
    shortLabel: "Demo local",
    productName: "Animación local de prueba, sin datos meteorológicos reales",
    attribution: "Modo demostrativo local. No usar para toma de decisiones.",
    isDemo: true,
    format: "SVG local como imagen MapLibre",
    crs: "EPSG:4326",
    expectedIntervalMs: 30 * 60 * 1000,
    staleThresholdMs: config.staleThresholdMs,
    pollingIntervalMs: config.pollingIntervalMs,
    async getLatestFrames(requestOptions = {}) {
      const now = new Date(requestOptions.now || Date.now());
      const start = new Date(now.getTime() - CLOUD_TOP_WINDOW_HOURS * 60 * 60 * 1000);
      const frames = [];
      for (let time = start.getTime(); time <= now.getTime(); time += 30 * 60 * 1000) {
        const timestamp = new Date(time).toISOString();
        frames.push({
          id: `demo-cloud-top-${timestamp}`,
          timestamp,
          url: buildDemoFrameUrl(timestamp),
          bounds: [
            [-99.65, 19.32],
            [-98.48, 19.32],
            [-98.48, 18.16],
            [-99.65, 18.16],
          ],
          attribution: "Modo demostrativo local. No son datos reales.",
          isDemo: true,
        });
      }
      return {
        providerId: this.id,
        providerLabel: this.label,
        attribution: this.attribution,
        productName: this.productName,
        isDemo: true,
        frames: normalizeCloudTopFrames(frames, { now, windowHours: CLOUD_TOP_WINDOW_HOURS }),
      };
    },
  };
}

export function extractWmsTimeDimension(xmlText, layerName) {
  if (!xmlText || !layerName) return [];
  const parser = typeof DOMParser === "function" ? new DOMParser() : null;
  if (parser) {
    const doc = parser.parseFromString(xmlText, "application/xml");
    const layers = [...doc.getElementsByTagName("Layer")];
    const layer = layers.find((candidate) => {
      const name = getDirectChildText(candidate, "Name");
      return name === layerName;
    });
    const dimension = [...(layer?.children || [])]
      .find((item) => item.localName === "Dimension" && item.getAttribute("name") === "time");
    return parseWmsTimeValues(dimension?.textContent || "");
  }

  const escapedName = escapeRegExp(layerName);
  const match = new RegExp(`<Layer[^>]*>[\\s\\S]*?<Name>${escapedName}</Name>[\\s\\S]*?<Dimension[^>]*name=["']time["'][^>]*>([\\s\\S]*?)</Dimension>[\\s\\S]*?</Layer>`, "i").exec(xmlText);
  return parseWmsTimeValues(match?.[1] || "");
}

export function parseWmsTimeValues(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !Number.isNaN(Date.parse(item)));
}

export function buildWmsTileUrl(timestamp) {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: NOWCOAST_LAYER,
    STYLES: "goes-lir",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    WIDTH: "256",
    HEIGHT: "256",
    CRS: "EPSG:3857",
    BBOX: "{bbox-epsg-3857}",
    TIME: timestamp,
  });
  return `${NOWCOAST_WMS_URL}?${params.toString().replace("%7Bbbox-epsg-3857%7D", "{bbox-epsg-3857}")}`;
}

export function buildWmsImageUrl(timestamp, options = {}) {
  const bounds = options.bounds || NOWCOAST_MORELOS_BOUNDS;
  const size = Math.max(256, Math.min(1536, Number(options.size || NOWCOAST_FRAME_SIZE)));
  const bbox = lngLatBoundsToWebMercatorBbox(bounds);
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: NOWCOAST_LAYER,
    STYLES: "goes-lir",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    WIDTH: String(size),
    HEIGHT: String(size),
    CRS: "EPSG:3857",
    BBOX: bbox.join(","),
    TIME: timestamp,
  });
  return `${NOWCOAST_WMS_URL}?${params.toString()}`;
}

export function validateProviderUrl(url, options = {}) {
  const parsed = new URL(url);
  if (options.allowDemoDataUrl && parsed.protocol === "data:") return true;
  if (parsed.protocol !== "https:") {
    throw new Error("La fuente meteorologica debe usar HTTPS.");
  }
  const allowedHosts = options.allowedHosts || NOWCOAST_ALLOWED_HOSTS;
  if (allowedHosts.size && !allowedHosts.has(parsed.hostname)) {
      throw new Error(`Dominio no permitido para proveedor meteorológico: ${parsed.hostname}`);
  }
  return true;
}

function buildNowcoastFrame(timestamp) {
  const tileUrl = buildWmsTileUrl(timestamp);
  const imageUrl = buildWmsImageUrl(timestamp);
  validateProviderUrl(tileUrl);
  validateProviderUrl(imageUrl);
  return {
    id: `nowcoast-goes-longwave-${timestamp}`,
    timestamp,
    sourceUrl: imageUrl,
    sourceTiles: [tileUrl],
    bounds: NOWCOAST_MORELOS_BOUNDS,
    width: NOWCOAST_FRAME_SIZE,
    height: NOWCOAST_FRAME_SIZE,
    cacheKey: `noaa-nowcoast-satellite-goes-longwave-imagery-goes-lir-${timestamp}-${NOWCOAST_MORELOS_BOUNDS.join("_")}-${NOWCOAST_FRAME_SIZE}`,
    originalTileTemplate: buildEnhancedWmsTileUrl(tileUrl),
    attribution: "NOAA/NOS nowCOAST, NOAA/NESDIS GOES; realce visual Band1 0-255",
    isDemo: false,
    styleName: "goes-lir",
    enhancement: GOES_IR_ENHANCEMENT_METADATA,
  };
}

export function lngLatBoundsToWebMercatorBbox(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    throw new Error("Bounds inválidos para cuadro GOES IR.");
  }
  const [west, south, east, north] = bounds.map(Number);
  if (![west, south, east, north].every(Number.isFinite)) {
    throw new Error("Bounds inválidos para cuadro GOES IR.");
  }
  const southwest = lngLatToWebMercator(west, south);
  const northeast = lngLatToWebMercator(east, north);
  return [southwest.x, southwest.y, northeast.x, northeast.y];
}

function lngLatToWebMercator(lng, lat) {
  const radius = 6378137;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return {
    x: radius * lng * Math.PI / 180,
    y: radius * Math.log(Math.tan(Math.PI / 4 + clampedLat * Math.PI / 360)),
  };
}

async function fetchTextWithTimeout(url, options = {}) {
  validateProviderUrl(url, { allowedHosts: options.allowedHosts || NOWCOAST_ALLOWED_HOSTS });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Servicio meteorológico no disponible (${response.status}).`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function buildDemoFrameUrl(timestamp) {
  const date = new Date(timestamp);
  const minutes = date.getUTCMinutes();
  const offset = (date.getUTCHours() * 11 + minutes) % 100;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
      <defs>
        <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#15324c" stop-opacity="0.62"/>
          <stop offset="1" stop-color="#8fb9c8" stop-opacity="0.22"/>
        </linearGradient>
        <filter id="soft"><feGaussianBlur stdDeviation="18"/></filter>
      </defs>
      <rect width="900" height="900" fill="url(#sky)" opacity="0.72"/>
      <g filter="url(#soft)" opacity="0.78">
        <ellipse cx="${230 + offset}" cy="250" rx="190" ry="82" fill="#f8f2d4"/>
        <ellipse cx="${520 - offset / 2}" cy="370" rx="260" ry="105" fill="#d7e8ec"/>
        <ellipse cx="${370 + offset / 3}" cy="610" rx="230" ry="96" fill="#fff4c1"/>
        <ellipse cx="${705 - offset}" cy="535" rx="175" ry="88" fill="#9dd0dd"/>
      </g>
      <text x="34" y="850" font-family="Arial, sans-serif" font-size="30" fill="#fff7e8">DEMO LOCAL</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getDirectChildText(element, localName) {
  return [...(element?.children || [])]
    .find((child) => child.localName === localName)
    ?.textContent
    ?.trim();
}
