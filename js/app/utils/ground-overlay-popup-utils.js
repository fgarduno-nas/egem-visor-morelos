export const GROUND_OVERLAY_NOTICE =
  "Esta capa es una imagen georreferenciada y no contiene atributos consultables por ubicacion.";

export const GROUND_OVERLAY_FALLBACK_LEGEND_LABEL = "Simbologia incorporada en la imagen";

export function getGroundOverlayBbox(overlay = {}) {
  if (overlay.bounds) {
    const west = Number(overlay.bounds.west);
    const south = Number(overlay.bounds.south);
    const east = Number(overlay.bounds.east);
    const north = Number(overlay.bounds.north);
    if (isValidBbox(west, south, east, north)) return { west, south, east, north };
  }

  if (Array.isArray(overlay.bbox) && overlay.bbox.length >= 4) {
    const [west, south, east, north] = overlay.bbox.map(Number);
    if (isValidBbox(west, south, east, north)) return { west, south, east, north };
  }

  if (Array.isArray(overlay.coordinates) && overlay.coordinates.length >= 4) {
    const longitudes = overlay.coordinates.map((coordinate) => Number(coordinate?.[0])).filter(Number.isFinite);
    const latitudes = overlay.coordinates.map((coordinate) => Number(coordinate?.[1])).filter(Number.isFinite);
    if (longitudes.length && latitudes.length) {
      return {
        west: Math.min(...longitudes),
        south: Math.min(...latitudes),
        east: Math.max(...longitudes),
        north: Math.max(...latitudes),
      };
    }
  }

  return null;
}

export function isPointInsideGroundOverlay(lngLat, overlay) {
  const bbox = getGroundOverlayBbox(overlay);
  if (!bbox) return false;
  const lng = Number(lngLat?.lng);
  const lat = Number(lngLat?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

export function pickTopGroundOverlayHit(candidates, lngLat, layerOrder) {
  return candidates
    .filter((candidate) => isPointInsideGroundOverlay(lngLat, candidate.overlay))
    .sort((a, b) => getLayerOrder(layerOrder, b.rasterLayerId) - getLayerOrder(layerOrder, a.rasterLayerId))[0] || null;
}

export function buildGroundOverlayInfoLines(layer = {}, options = {}) {
  const properties = layer.metadata?.properties || {};
  const metadata = layer.metadata || {};
  const isUsableValue = options.isUsableValue || defaultIsUsableValue;
  const formatDate = options.formatDate || ((value) => value);
  const updatedAt = getFirstUsableValue(isUsableValue, properties.updatedAt, metadata.updatedAt, layer.updatedAt);
  const lines = [
    ["Nombre publico", layer.title],
    ["Fenomeno", properties.phenomenon || metadata.phenomenon || options.categoryTitle],
    ["Tipo", "Imagen raster georreferenciada"],
    ["Descripcion", layer.description || properties.description || metadata.description],
    ["Municipio o cobertura", properties.coverage || metadata.coverage || layer.municipality],
    ["Fuente", properties.source || metadata.source || layer.source],
    ["Dependencia responsable", properties.responsibleAgency || metadata.responsibleAgency || layer.responsibleAgency],
    ["Fecha de actualizacion", updatedAt ? formatDate(updatedAt) : null],
    ["Escala o resolucion", properties.scaleOrResolution || metadata.scaleOrResolution || layer.scaleOrResolution],
    ["Sistema de referencia", properties.crs || metadata.crs || layer.crs],
  ];

  return lines
    .map(([label, value]) => ({ label, value }))
    .filter(({ value }) => isUsableValue(value) && String(value).trim() !== "Sin especificar");
}

export const buildGroundOverlayInfoRows = buildGroundOverlayInfoLines;

function isValidBbox(west, south, east, north) {
  return [west, south, east, north].every(Number.isFinite) && west <= east && south <= north;
}

function getLayerOrder(layerOrder, layerId) {
  if (layerOrder instanceof Map) return layerOrder.has(layerId) ? layerOrder.get(layerId) : -1;
  return Number.isFinite(Number(layerOrder?.[layerId])) ? Number(layerOrder[layerId]) : -1;
}

function getFirstUsableValue(isUsableValue, ...values) {
  return values.find((value) => isUsableValue(value)) || null;
}

function defaultIsUsableValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "object") return false;
  return String(value).trim() !== "";
}
