import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLOUD_TOP_LAST_FRAME_HOLD_MS,
  CLOUD_TOP_SPEEDS,
  CloudTopPlaybackController,
  detectTemporalGaps,
  formatFrameTime,
  getFrameAgeStatus,
  mergeCloudTopFrames,
  normalizeCloudTopFrames,
  shouldAutoPlay,
} from "../js/app/weather/cloud-top-animation.js";
import {
  buildWmsTileUrl,
  buildWmsImageUrl,
  CLOUD_TOP_PROVIDER_CONFIG,
  createCloudTopProvider,
  createDemoCloudTopProvider,
  extractWmsTimeDimension,
  lngLatBoundsToWebMercatorBbox,
  NOWCOAST_FRAME_SIZE,
  parseWmsTimeValues,
  selectSteppedFrames,
  validateProviderUrl,
} from "../js/app/weather/cloud-top-provider.js";
import {
  CloudTopMapLayer,
  boundsToImageCoordinates,
} from "../js/app/weather/cloud-top-layer.js";
import {
  GOES_IR_COLOR_RAMP,
  GOES_IR_ENHANCEMENT_METADATA,
  analyzeEnhancedImageData,
  analyzeInfraredImageData,
  buildEnhancedWmsTileUrl,
  buildPersistentFrameCacheKey,
  createGoesIrFrameRenderer,
  createPersistentFrameCache,
  createEnhancedTileCache,
  decodeEnhancedTileUrl,
  enhanceInfraredImageData,
  getBandValueFromRenderedPixel,
  interpolateRampColor,
  validateImageResponse,
  validateColorRamp,
} from "../js/app/weather/cloud-top-enhancement.js";

const NOW = "2026-08-21T18:00:00.000Z";

test("normalizes frames in chronological order, six-hour window, and removes duplicates", () => {
  const frames = normalizeCloudTopFrames([
    { timestamp: "2026-08-21T17:00:00.000Z" },
    { timestamp: "2026-08-21T12:30:00.000Z" },
    { timestamp: "invalid" },
    { timestamp: "2026-08-21T11:59:00.000Z" },
    { timestamp: "2026-08-21T17:00:00.000Z", id: "duplicate" },
  ], { now: NOW });

  assert.deepEqual(frames.map((frame) => frame.timestamp), [
    "2026-08-21T12:30:00.000Z",
    "2026-08-21T17:00:00.000Z",
  ]);
});

test("formats UTC timestamps in America/Mexico_City and handles midnight crossings", () => {
  assert.match(formatFrameTime("2026-08-21T05:30:00.000Z"), /20 ago|21 ago|23:30/);
  assert.match(formatFrameTime("2026-08-21T18:00:00.000Z", { includeDate: false }), /12:00/);
});

test("detects temporal gaps and stale data", () => {
  const frames = normalizeCloudTopFrames([
    { timestamp: "2026-08-21T16:00:00.000Z" },
    { timestamp: "2026-08-21T16:05:00.000Z" },
    { timestamp: "2026-08-21T16:25:00.000Z" },
  ], { now: NOW });
  const gaps = detectTemporalGaps(frames, 5 * 60 * 1000);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].minutes, 20);

  const age = getFrameAgeStatus("2026-08-21T15:30:00.000Z", {
    now: NOW,
    thresholdMs: 2 * 60 * 60 * 1000,
  });
  assert.equal(age.isStale, true);
});

test("playback supports play, pause, previous, next, loop and last-frame hold", () => {
  const scheduled = [];
  const controller = new CloudTopPlaybackController({
    frameDurationMs: CLOUD_TOP_SPEEDS.normal,
    lastFrameHoldMs: CLOUD_TOP_LAST_FRAME_HOLD_MS,
    setTimeoutFn: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeoutFn: () => {},
  });

  controller.setFrames([
    { timestamp: "2026-08-21T17:50:00.000Z" },
    { timestamp: "2026-08-21T17:55:00.000Z" },
  ], { index: 0 });
  controller.play();
  assert.equal(controller.getState().playing, true);
  assert.equal(scheduled.at(-1).delay, CLOUD_TOP_SPEEDS.normal);

  controller.next();
  assert.equal(controller.getState().index, 1);
  assert.equal(scheduled.at(-1).delay, CLOUD_TOP_LAST_FRAME_HOLD_MS);

  controller.next();
  assert.equal(controller.getState().index, 0);
  controller.previous();
  assert.equal(controller.getState().index, 1);

  controller.pause();
  assert.equal(controller.getState().playing, false);
  controller.destroy();
  assert.equal(controller.getState().frameCount, 0);
});

test("playback does not autoplay with one frame or hidden visualization", () => {
  assert.equal(shouldAutoPlay({ frameCount: 1 }), false);
  assert.equal(shouldAutoPlay({ frameCount: 2, visible: false }), false);
  assert.equal(shouldAutoPlay({ frameCount: 2, visible: true }), true);
});

test("merges new frames without duplicates and keeps latest six-hour window", () => {
  const frames = mergeCloudTopFrames(
    [{ timestamp: "2026-08-21T16:00:00.000Z" }],
    [
      { timestamp: "2026-08-21T16:00:00.000Z" },
      { timestamp: "2026-08-21T18:00:00.000Z" },
    ],
    { now: NOW }
  );
  assert.deepEqual(frames.map((frame) => frame.timestamp), [
    "2026-08-21T16:00:00.000Z",
    "2026-08-21T18:00:00.000Z",
  ]);
});

test("provider parses WMS times and builds secure nowCOAST tile URLs", () => {
  const xml = `
    <WMS_Capabilities>
      <Layer>
        <Name>satellite:goes_longwave_imagery</Name>
        <Dimension name="time">2026-08-21T17:55:00.000Z,2026-08-21T18:00:00.000Z</Dimension>
      </Layer>
    </WMS_Capabilities>
  `;
  assert.deepEqual(extractWmsTimeDimension(xml, "satellite:goes_longwave_imagery"), [
    "2026-08-21T17:55:00.000Z",
    "2026-08-21T18:00:00.000Z",
  ]);
  assert.deepEqual(parseWmsTimeValues("bad,2026-08-21T18:00:00.000Z"), ["2026-08-21T18:00:00.000Z"]);
  const tileUrl = buildWmsTileUrl("2026-08-21T18:00:00.000Z");
  assert.match(tileUrl, /^https:\/\/nowcoast\.noaa\.gov\/geoserver\/ows/);
  assert.match(tileUrl, /BBOX=\{bbox-epsg-3857\}/);
  assert.match(tileUrl, /STYLES=goes-lir/);
  assert.match(tileUrl, /FORMAT=image%2Fpng/);
  assert.match(tileUrl, /TRANSPARENT=true/);
  const imageUrl = buildWmsImageUrl("2026-08-21T18:00:00.000Z");
  assert.equal(NOWCOAST_FRAME_SIZE, 640);
  assert.match(imageUrl, /WIDTH=640/);
  assert.match(imageUrl, /HEIGHT=640/);
  assert.match(imageUrl, /BBOX=-/);
  assert.equal(lngLatBoundsToWebMercatorBbox([-99.85, 18.02, -98.3, 19.48]).length, 4);
  assert.equal(validateProviderUrl(tileUrl), true);
  assert.equal(validateProviderUrl(imageUrl), true);
  assert.throws(() => validateProviderUrl("http://example.test/cloud.png"), /HTTPS/);
  assert.throws(() => validateProviderUrl("https://example.test/cloud.png"), /Dominio/);
});

test("selects real available frames near ten-minute intervals without duplicates", () => {
  const frames = [];
  for (let minute = 0; minute <= 60; minute += 5) {
    frames.push({ timestamp: new Date(Date.parse("2026-08-21T17:00:00.000Z") + minute * 60000).toISOString() });
  }
  const selected = selectSteppedFrames(frames, {
    now: "2026-08-21T18:00:00.000Z",
    windowHours: 1,
    stepMinutes: 10,
  });
  assert.deepEqual(selected.map((frame) => frame.timestamp), [
    "2026-08-21T17:00:00.000Z",
    "2026-08-21T17:10:00.000Z",
    "2026-08-21T17:20:00.000Z",
    "2026-08-21T17:30:00.000Z",
    "2026-08-21T17:40:00.000Z",
    "2026-08-21T17:50:00.000Z",
    "2026-08-21T18:00:00.000Z",
  ]);
  assert.equal(new Set(selected.map((frame) => frame.timestamp)).size, selected.length);
});

test("enhanced WMS tile URLs preserve the official nowCOAST source URL", () => {
  const tileUrl = buildWmsTileUrl("2026-08-21T18:00:00.000Z");
  const enhancedUrl = buildEnhancedWmsTileUrl(tileUrl);
  assert.match(enhancedUrl, /^goes-enhanced:\/\/nowcoast\.noaa\.gov\/geoserver\/ows/);
  assert.equal(decodeEnhancedTileUrl(enhancedUrl), tileUrl);
});

test("infrared enhancement uses the documented Band1 0-255 range without Celsius thresholds", () => {
  assert.deepEqual(GOES_IR_ENHANCEMENT_METADATA.documentedRange, [0, 255]);
  assert.equal(GOES_IR_ENHANCEMENT_METADATA.sourceBand, "Band1");
  assert.equal(GOES_IR_ENHANCEMENT_METADATA.sourceStyle, "goes-lir");
  assert.equal(getBandValueFromRenderedPixel(255, 255, 255), 0);
  assert.equal(getBandValueFromRenderedPixel(0, 0, 0), 255);
  assert.match(GOES_IR_ENHANCEMENT_METADATA.interpretation, /ni representa lluvia, peligro/i);
  assert.doesNotMatch(GOES_IR_ENHANCEMENT_METADATA.interpretation, /°C/);
});

test("color ramp is ordered from transparent weaker signal to stronger IR signal", () => {
  const ramp = validateColorRamp(GOES_IR_COLOR_RAMP);
  assert.equal(ramp[0].quantity, 0);
  assert.equal(ramp.at(-1).quantity, 255);
  assert.equal(ramp[0].opacity, 0);
  assert.ok(ramp.at(-1).opacity > ramp[0].opacity);

  const weak = interpolateRampColor(0, GOES_IR_COLOR_RAMP);
  const strong = interpolateRampColor(255, GOES_IR_COLOR_RAMP);
  assert.equal(weak.opacity, 0);
  assert.deepEqual([strong.r, strong.g, strong.b], [255, 36, 51]);
});

test("enhancement makes no-data and weaker signal transparent while preserving colored clouds", () => {
  const source = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      100, 100, 100, 0,
    ]),
  };
  const enhanced = enhanceInfraredImageData(source, {
    ramp: GOES_IR_COLOR_RAMP,
    signalThreshold: 120,
    signalUpper: 255,
  });
  assert.ok(enhanced.data[3] > 200, "stronger signal remains visible");
  assert.notEqual(enhanced.data[0], enhanced.data[1], "stronger signal is colorized");
  assert.equal(enhanced.data[7], 0, "weaker end of official range becomes transparent");
  assert.equal(enhanced.data[11], 0, "source NoData alpha remains transparent");
});

test("image diagnostics detect source signal, visible colors and transparent pixels", () => {
  const source = {
    width: 4,
    height: 1,
    data: new Uint8ClampedArray([
      255, 255, 255, 255,
      90, 90, 90, 255,
      60, 60, 60, 255,
      0, 0, 0, 0,
    ]),
  };
  const sourceStats = analyzeInfraredImageData(source);
  assert.equal(sourceStats.totalPixels, 4);
  assert.equal(sourceStats.sourceOpaquePixels, 3);
  assert.equal(sourceStats.minBand, 0);
  assert.equal(sourceStats.maxBand, 195);

  const enhanced = enhanceInfraredImageData(source, {
    ramp: GOES_IR_COLOR_RAMP,
    signalThreshold: 120,
    signalUpper: 200,
  });
  const enhancedStats = analyzeEnhancedImageData(enhanced);
  assert.ok(enhancedStats.enhancedVisiblePixels > 0);
  assert.ok(enhancedStats.transparentPixels > 0);
  assert.ok(enhancedStats.visibleColorCount > 1);
  assert.ok(enhancedStats.enhancedVisiblePercent < 75);
});

test("adaptive transparency keeps only the upper thermal signal instead of almost every pixel", () => {
  const values = Array.from({ length: 100 }, (_, index) => index + 50);
  const data = new Uint8ClampedArray(values.flatMap((band) => {
    const gray = 255 - band;
    return [gray, gray, gray, 255];
  }));
  const enhanced = enhanceInfraredImageData({ width: 100, height: 1, data }, {
    ramp: GOES_IR_COLOR_RAMP,
    visiblePercentile: 85,
    upperPercentile: 99,
    minimumSignalThreshold: 90,
  });
  const stats = analyzeEnhancedImageData(enhanced);
  assert.ok(stats.enhancedVisiblePercent > 5);
  assert.ok(stats.enhancedVisiblePercent < 25);
  assert.ok(stats.visibleColorCount > 3);
  assert.ok(stats.signalThreshold >= 130);
});

test("HTTP 200 XML error responses are rejected as invalid GOES imagery", async () => {
  await assert.rejects(
    () => validateImageResponse({
      ok: true,
      status: 200,
      headers: new Map([["Content-Type", "application/vnd.ogc.se_xml"]]),
    }),
    /Content-Type/
  );
});

test("enhanced tile cache avoids duplicate processing and evicts oldest entries", () => {
  const cache = createEnhancedTileCache({ maxEntries: 2 });
  const first = new ArrayBuffer(2);
  cache.set("a", first);
  cache.set("a", first);
  assert.equal(cache.size(), 1);
  assert.equal(cache.get("a"), first);
  cache.set("b", new ArrayBuffer(2));
  cache.set("c", new ArrayBuffer(2));
  assert.equal(cache.has("a"), false);
  assert.equal(cache.size(), 2);
});

test("frame renderer caches processed frames and deduplicates simultaneous requests", async () => {
  let fetchCount = 0;
  let objectUrlCount = 0;
  const renderer = createGoesIrFrameRenderer({
    fetchFn: async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        headers: new Map([["Content-Type", "image/png"]]),
        blob: async () => new Blob(["png"], { type: "image/png" }),
      };
    },
    renderFn: async () => ({
      blob: new Blob(["enhanced"], { type: "image/png" }),
      width: 2,
      height: 2,
      diagnostics: {
        totalPixels: 4,
        sourceOpaquePixels: 4,
        minBand: 90,
        maxBand: 180,
        bandBuckets: [0, 1, 2, 1, 0],
        enhancedVisiblePixels: 3,
        enhancedVisiblePercent: 75,
        transparentPixels: 1,
        transparentPercent: 25,
        visibleColorCount: 3,
      },
    }),
    createObjectUrl: () => {
      objectUrlCount += 1;
      return `blob:test-${objectUrlCount}`;
    },
  });
  const frame = {
    id: "frame",
    timestamp: NOW,
    sourceUrl: "https://nowcoast.noaa.gov/geoserver/ows?REQUEST=GetMap",
    cacheKey: "frame-key",
    bounds: [-99, 18, -98, 19],
  };

  const [first, second] = await Promise.all([renderer.loadFrame(frame), renderer.loadFrame(frame)]);
  assert.equal(fetchCount, 1);
  assert.equal(first.url, second.url);
  assert.equal(renderer.getStats().dedupedRequests, 1);

  const cached = await renderer.loadFrame(frame);
  assert.equal(cached.fromCache, true);
  assert.equal(fetchCount, 1);
  assert.equal(renderer.getStats().cacheHits, 1);
});

test("persistent frame cache keys include ramp version and can be disabled safely", async () => {
  const key = "noaa-nowcoast-satellite-goes-longwave-imagery-goes-lir-2026-08-21T18:00:00.000Z--99_18_-98_19-640";
  assert.match(buildPersistentFrameCacheKey(key), /thermal-ir-v2/);
  assert.match(buildPersistentFrameCacheKey(key), /goes-lir/);
  const cache = createPersistentFrameCache({ enabled: false });
  assert.equal(await cache.get(key), null);
  await cache.set(key, { url: "blob:test" });
  await cache.prune();
});

test("demo provider is clearly marked and returns local demo frames", async () => {
  const provider = createDemoCloudTopProvider();
  const result = await provider.getLatestFrames({ now: NOW });
  assert.equal(result.isDemo, true);
  assert.match(result.attribution, /demostrativo/i);
  assert.ok(result.frames.length >= 12);
  assert.ok(result.frames.every((frame) => frame.isDemo && frame.url.startsWith("data:image/svg+xml")));
});

test("default provider does not enable demo fallback automatically", () => {
  assert.equal(CLOUD_TOP_PROVIDER_CONFIG.enableDemoFallback, false);
  assert.equal(createCloudTopProvider(CLOUD_TOP_PROVIDER_CONFIG).fallbackProvider, null);
  assert.equal(createCloudTopProvider({ ...CLOUD_TOP_PROVIDER_CONFIG, enableDemoFallback: true }).fallbackProvider?.isDemo, true);
});

test("map layer uses two buffered raster layers and respects opacity, visibility and order", async () => {
  const map = createMockMap();
  const layer = new CloudTopMapLayer(map, { opacity: 0.5 });
  await layer.showFrame({
    id: "frame-1",
    timestamp: NOW,
    tiles: ["https://nowcoast.noaa.gov/geoserver/ows?BBOX={bbox-epsg-3857}"],
    tileSize: 256,
    attribution: "NOAA",
  });
  await layer.showFrame({
    id: "frame-2",
    timestamp: NOW,
    tiles: ["https://nowcoast.noaa.gov/geoserver/ows?BBOX={bbox-epsg-3857}&TIME=2"],
    tileSize: 256,
    attribution: "NOAA",
  });

  assert.deepEqual(map.layerIds().sort(), [
    "cloud-top-animation-layer-1",
    "cloud-top-animation-layer-2",
  ]);
  assert.ok(map.moveCalls.every((call) => call.beforeId === "estado-fill"));
  layer.setOpacity(0.35);
  layer.setVisible(false);
  assert.equal(map.layers.get("cloud-top-animation-layer-1").paint["raster-opacity"], 0.35);
  assert.equal(map.layers.get("cloud-top-animation-layer-2").paint["raster-opacity"], 0);
  assert.equal(map.layers.get("cloud-top-animation-layer-1").layout.visibility, "none");
  layer.destroy();
  assert.equal(map.layers.has("cloud-top-animation-layer-1"), false);
  assert.equal(map.layers.has("cloud-top-animation-layer-2"), false);
  assert.equal(map.sources.has("cloud-top-animation-source-1"), false);
  assert.equal(map.sources.has("cloud-top-animation-source-2"), false);
});

test("image double buffer keeps one visible layer and reuses image sources safely", async () => {
  const map = createMockMap();
  const layer = new CloudTopMapLayer(map, { opacity: 0.58 });
  const frame = {
    id: "frame-image-1",
    timestamp: NOW,
    url: "blob:test-1",
    bounds: [-99, 18, -98, 19],
  };
  await layer.showFrame(frame);
  assert.equal(map.layers.get("cloud-top-animation-layer-2").paint["raster-opacity"], 0.58);
  assert.ok(layer.getLayerIds().some((id) => map.layers.get(id)?.paint["raster-opacity"] > 0));

  await layer.showFrame({ ...frame, id: "frame-image-2", url: "blob:test-2" });
  const visibleLayers = layer.getLayerIds()
    .map((id) => map.layers.get(id)?.paint["raster-opacity"] || 0)
    .filter((opacity) => opacity > 0);
  assert.equal(visibleLayers.length, 1);
  assert.equal(visibleLayers[0], 0.58);
  await layer.showFrame({ ...frame, id: "frame-image-3", url: "blob:test-3" });
  assert.equal(map.sources.get("cloud-top-animation-source-2").updatedUrl, "blob:test-3");
});

test("image bounds are converted to MapLibre image coordinates", () => {
  assert.deepEqual(boundsToImageCoordinates([-99, 18, -98, 19]), [
    [-99, 19],
    [-98, 19],
    [-98, 18],
    [-99, 18],
  ]);
});

test("map integration keeps GOES IR outside the layer catalog and removes manual controls", () => {
  const mapSource = readFileSync(new URL("../js/map.js", import.meta.url), "utf8");
  const cssSource = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");

  assert.doesNotMatch(mapSource, /cloudTopCatalogLayer|weather-animation|data-weather-controls/);
  assert.doesNotMatch(mapSource, /cloud-top-play|cloud-top-previous|cloud-top-next|cloud-top-range|cloud-top-speed|cloud-top-visible/);
  assert.doesNotMatch(mapSource, /Hidrometeorologicos[\\s\\S]{0,200}GOES|Tope de nube/);
  assert.match(mapSource, /Imagen infrarroja GOES realzada/);
  assert.match(mapSource, /createGoesIrFrameRenderer/);
  assert.match(mapSource, /visibleFrame/);
  assert.match(mapSource, /startProgressiveCloudTopPlayback/);
  assert.match(mapSource, /loadCloudTopFramesInBackground/);
  assert.match(mapSource, /maxConcurrent = 2/);
  assert.ok(mapSource.indexOf("showTrialNoticeModal();") < mapSource.indexOf("await loadStaticData();"));
  assert.match(mapSource, /goes-ir-indicator/);
  assert.match(mapSource, /initializeCloudTopAnimation\(\)/);
  assert.doesNotMatch(cssSource, /cloud-top-button|cloud-top-slider|cloud-top-toggle/);
  assert.match(cssSource, /goes-ir-indicator/);
});

function createMockMap() {
  return {
    sources: new Map(),
    layers: new Map(),
    moveCalls: [],
    getSource(id) {
      return this.sources.get(id);
    },
    addSource(id, source) {
      if (source.type === "image") {
        source.updateImage = function updateImage(next) {
          this.updatedUrl = next.url;
          this.coordinates = next.coordinates;
        };
      }
      this.sources.set(id, source);
    },
    removeSource(id) {
      this.sources.delete(id);
    },
    getLayer(id) {
      if (id === "estado-fill") return this.layers.get(id) || { id };
      return this.layers.get(id);
    },
    addLayer(layer) {
      this.layers.set(layer.id, layer);
    },
    removeLayer(id) {
      this.layers.delete(id);
    },
    moveLayer(layerId, beforeId) {
      this.moveCalls.push({ layerId, beforeId });
    },
    setLayoutProperty(id, property, value) {
      this.layers.get(id).layout[property] = value;
    },
    setPaintProperty(id, property, value) {
      this.layers.get(id).paint[property] = value;
    },
    layerIds() {
      return [...this.layers.keys()];
    },
  };
}
