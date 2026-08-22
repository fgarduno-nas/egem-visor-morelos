export class CloudTopMapLayer {
  constructor(map, options = {}) {
    this.map = map;
    this.sourceId = options.sourceId || "cloud-top-animation-source";
    this.layerId = options.layerId || "cloud-top-animation-layer";
    this.bufferCount = 2;
    this.activeBuffer = 0;
    this.beforeLayerIds = options.beforeLayerIds || [
      "estado-fill",
      "estado",
      "estado-highlight-halo",
      "estado-highlight",
      "municipios-hit",
      "municipios",
      "measure-line-layer",
      "measure-point-layer",
    ];
    this.opacity = Number.isFinite(options.opacity) ? options.opacity : 0.72;
    this.visible = options.visible !== false;
    this.fadeDurationMs = Number.isFinite(options.fadeDurationMs) ? options.fadeDurationMs : 450;
    this.currentFrameId = null;
    this.imageCache = new Set();
    this.maxCachedImages = options.maxCachedImages || 8;
  }

  async showFrame(frame) {
    if (!frame) return;
    await this.preloadFrame(frame);
    const beforeId = this.resolveBeforeLayerId();
    const nextBuffer = this.activeBuffer === 0 ? 1 : 0;

    if (Array.isArray(frame.tiles) && frame.tiles.length) {
      this.upsertRasterTileFrame(frame, beforeId, nextBuffer);
    } else if (frame.url && Array.isArray(frame.bounds)) {
      this.upsertImageFrame(frame, beforeId, nextBuffer);
    } else {
      throw new Error("El cuadro meteorológico no contiene tiles ni imagen georreferenciada.");
    }

    this.fadeToBuffer(nextBuffer);
    this.activeBuffer = nextBuffer;
    this.currentFrameId = frame.id;
    this.setVisible(this.visible);
    this.setOpacity(this.opacity);
    this.moveBelowReferenceLayers();
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.getLayerIds().forEach((layerId) => {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, "visibility", this.visible ? "visible" : "none");
      }
    });
  }

  setOpacity(opacity) {
    const numeric = Number(opacity);
    this.opacity = Number.isFinite(numeric) ? Math.min(1, Math.max(0.1, numeric)) : this.opacity;
    this.getLayerIds().forEach((layerId, index) => {
      if (this.map.getLayer(layerId)) {
        this.map.setPaintProperty(layerId, "raster-opacity", index === this.activeBuffer ? this.opacity : 0);
      }
    });
  }

  destroy() {
    this.getLayerIds().forEach((layerId) => {
      if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    });
    this.getSourceIds().forEach((sourceId) => {
      if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
    });
    this.currentFrameId = null;
    this.imageCache.clear();
  }

  async preloadFrame(frame) {
    const urls = Array.isArray(frame.tiles) && frame.tiles.length ? frame.tiles.slice(0, 2) : [frame.url];
    const candidates = urls.filter((url) => url && !url.includes("{bbox-epsg-3857}") && !this.imageCache.has(url));
    await Promise.all(candidates.map((url) => preloadImage(url).then(() => this.rememberImage(url))));
  }

  upsertRasterTileFrame(frame, beforeId, bufferIndex = this.activeBuffer) {
    const sourceId = this.getSourceId(bufferIndex);
    const layerId = this.getLayerId(bufferIndex);
    const source = this.map.getSource(sourceId);
    if (source) {
      if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
      this.map.removeSource(sourceId);
    }
    this.map.addSource(sourceId, {
      type: "raster",
      tiles: frame.tiles,
      tileSize: frame.tileSize || 256,
      attribution: frame.attribution,
    });
    this.map.addLayer({
      id: layerId,
      type: "raster",
      source: sourceId,
      layout: {
        visibility: this.visible ? "visible" : "none",
      },
      paint: {
        "raster-opacity": 0,
        "raster-fade-duration": this.fadeDurationMs,
      },
    }, beforeId);
  }

  upsertImageFrame(frame, beforeId, bufferIndex = this.activeBuffer) {
    const sourceId = this.getSourceId(bufferIndex);
    const layerId = this.getLayerId(bufferIndex);
    const coordinates = boundsToImageCoordinates(frame.bounds);
    const source = this.map.getSource(sourceId);
    if (source && typeof source.updateImage === "function") {
      source.updateImage({ url: frame.url, coordinates });
    } else {
      if (source) {
        if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
        this.map.removeSource(sourceId);
      }
      this.map.addSource(sourceId, {
        type: "image",
        url: frame.url,
        coordinates,
      });
      this.map.addLayer({
        id: layerId,
        type: "raster",
        source: sourceId,
        layout: {
          visibility: this.visible ? "visible" : "none",
        },
        paint: {
          "raster-opacity": 0,
          "raster-fade-duration": this.fadeDurationMs,
        },
      }, beforeId);
    }
  }

  moveBelowReferenceLayers() {
    const beforeId = this.resolveBeforeLayerId();
    if (beforeId) {
      try {
        this.getLayerIds().forEach((layerId) => {
          if (this.map.getLayer(layerId)) this.map.moveLayer(layerId, beforeId);
        });
      } catch (error) {
        console.warn("No se pudo reordenar la animación meteorológica:", error);
      }
    }
  }

  resolveBeforeLayerId() {
    return this.beforeLayerIds.find((layerId) => this.map.getLayer(layerId)) || undefined;
  }

  rememberImage(url) {
    this.imageCache.add(url);
    if (this.imageCache.size <= this.maxCachedImages) return;
    const first = this.imageCache.values().next().value;
    this.imageCache.delete(first);
  }

  fadeToBuffer(bufferIndex) {
    this.getLayerIds().forEach((layerId, index) => {
      if (!this.map.getLayer(layerId)) return;
      this.map.setPaintProperty(layerId, "raster-opacity", index === bufferIndex && this.visible ? this.opacity : 0);
    });
  }

  getSourceId(bufferIndex) {
    return `${this.sourceId}-${bufferIndex + 1}`;
  }

  getLayerId(bufferIndex) {
    return `${this.layerId}-${bufferIndex + 1}`;
  }

  getSourceIds() {
    return Array.from({ length: this.bufferCount }, (_, index) => this.getSourceId(index));
  }

  getLayerIds() {
    return Array.from({ length: this.bufferCount }, (_, index) => this.getLayerId(index));
  }
}

export function boundsToImageCoordinates(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    throw new Error("Bounds inválidos para imagen meteorológica.");
  }
  if (Array.isArray(bounds[0]) && bounds[0].length === 2) return bounds;
  const [west, south, east, north] = bounds.map(Number);
  if (![west, south, east, north].every(Number.isFinite)) {
    throw new Error("Bounds inválidos para imagen meteorológica.");
  }
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}

function preloadImage(url) {
  if (!url || typeof Image !== "function") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(url);
    image.onerror = () => reject(new Error("No se pudo precargar un cuadro meteorológico."));
    image.src = url;
  });
}
