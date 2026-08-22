import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  GROUND_OVERLAY_FALLBACK_LEGEND_LABEL,
  GROUND_OVERLAY_NOTICE,
  buildGroundOverlayInfoLines,
  getGroundOverlayBbox,
  isPointInsideGroundOverlay,
  pickTopGroundOverlayHit,
} from "../js/app/utils/ground-overlay-popup-utils.js";

test("detecta clic dentro y fuera de la extension GroundOverlay", () => {
  const overlay = {
    bounds: {
      west: -99.6,
      south: 18.2,
      east: -98.5,
      north: 19.2,
    },
  };

  assert.equal(isPointInsideGroundOverlay({ lng: -99, lat: 18.8 }, overlay), true);
  assert.equal(isPointInsideGroundOverlay({ lng: -100, lat: 18.8 }, overlay), false);
  assert.equal(isPointInsideGroundOverlay({ lng: -99, lat: 19.5 }, overlay), false);
});

test("calcula bbox desde coordenadas persistidas NW NE SE SW", () => {
  const bbox = getGroundOverlayBbox({
    coordinates: [
      [-99.6, 19.2],
      [-98.5, 19.2],
      [-98.5, 18.2],
      [-99.6, 18.2],
    ],
  });

  assert.deepEqual(bbox, {
    west: -99.6,
    south: 18.2,
    east: -98.5,
    north: 19.2,
  });
});

test("elige la raster superior segun el orden visual de MapLibre", () => {
  const lower = {
    layer: { id: "raster-a" },
    rasterLayerId: "raster-a-raster",
    overlay: { bbox: [-100, 18, -98, 20] },
  };
  const upper = {
    layer: { id: "raster-b" },
    rasterLayerId: "raster-b-raster",
    overlay: { bbox: [-100, 18, -98, 20] },
  };

  const hit = pickTopGroundOverlayHit([lower, upper], { lng: -99, lat: 19 }, new Map([
    ["raster-a-raster", 4],
    ["raster-b-raster", 9],
  ]));

  assert.equal(hit, upper);
});

test("omite campos vacíos y no inventa información por píxel", () => {
  const rows = buildGroundOverlayInfoLines({
    title: "Inestabilidad de Laderas",
    description: "",
    municipality: null,
    metadata: {
      properties: {
        source: "Inventario EGEM",
        responsibleAgency: "",
        updatedAt: "2026-08-12T00:00:00.000Z",
        crs: "EPSG:4326",
      },
    },
  }, {
    categoryTitle: "Fenomenos Geologicos",
    formatDate: () => "12/08/2026",
  });

  assert.deepEqual(rows, [
    { label: "Nombre público", value: "Inestabilidad de Laderas" },
    { label: "Fenómeno", value: "Fenomenos Geologicos" },
    { label: "Tipo", value: "Imagen raster georreferenciada" },
    { label: "Fuente", value: "Inventario EGEM" },
    { label: "Fecha de actualización", value: "12/08/2026" },
    { label: "Sistema de referencia", value: "EPSG:4326" },
  ]);
  assert.equal(rows.some((row) => String(row.value).includes("muy alto")), false);
});

test("expone aviso raster y texto fallback de simbología sin clasificar colores", () => {
  assert.equal(GROUND_OVERLAY_NOTICE, "Esta capa es una imagen georreferenciada y no contiene atributos consultables por ubicación.");
  assert.equal(GROUND_OVERLAY_FALLBACK_LEGEND_LABEL, "Simbología incorporada en la imagen");
});

test("map.js prioriza vector, usa un solo listener global y conserva popup vectorial", async () => {
  const source = await fs.readFile(path.resolve("js/map.js"), "utf8");
  const helperSource = await fs.readFile(path.resolve("js/app/utils/ground-overlay-popup-utils.js"), "utf8");

  assert.match(helperSource, /export function buildGroundOverlayInfoLines/);
  assert.match(source, /buildGroundOverlayInfoLines,\s*\n\s*pickTopGroundOverlayHit,/);
  assert.match(source, /map\.on\("click", \(event\) => \{\s*handleMapToolClick\(event\);/);
  assert.equal((source.match(/map\.on\("click", \(event\) => \{/g) || []).length, 1);
  assert.match(source, /const thematicHit = getTopThematicPopupHit\(event\);/);
  assert.match(source, /\[\.\.\.state\.activeLayerStack\]\.reverse\(\)/);
  assert.match(source, /const vectorHit = getVectorPopupHitForLayer\(layer, event\);/);
  assert.match(source, /const rasterHit = getRasterPopupHitForLayer\(layer, event\.lngLat\);/);
  assert.match(source, /map\.queryRenderedFeatures\(event\.point, \{ layers: layerIds \}\)/);
  assert.match(source, /if \(!hasPopupProperties\(props\)\) return;/);
  assert.match(source, /buildFeaturePopup\(layer\.title, props\)/);
  assert.match(source, /buildGroundOverlayPopup\(layer\)/);
});

test("el contrato backend persiste y publica GroundOverlay sin Object URL temporal", async () => {
  const layerService = await fs.readFile(path.resolve("backend/src/modules/layers/layers.service.js"), "utf8");
  const processingService = await fs.readFile(path.resolve("backend/src/modules/layers/layer-processing.service.js"), "utf8");
  const mapSource = await fs.readFile(path.resolve("js/map.js"), "utf8");

  assert.match(layerService, /resourceType:\s*processing\.resourceType/);
  assert.match(layerService, /groundOverlays:\s*processing\.groundOverlays/);
  assert.match(layerService, /rasterLegend,/);
  assert.match(layerService, /status:\s*LAYER_STATUS\.PUBLISHED/);
  assert.match(layerService, /status\s*=\s*\r?\n\s*actor\.role === ROLE_CODES\.ADMIN \? LAYER_STATUS\.APPROVED : LAYER_STATUS\.PENDING_REVIEW/);
  assert.match(processingService, /path\.join\(env\.UPLOAD_BASE_DIR,\s*"processed",\s*layerId,\s*"layer\.geojson"\)/);
  assert.match(processingService, /extractGroundOverlayImages\(\{/);
  assert.match(mapSource, /createGroundOverlayLayerFromBackend/);
  assert.match(mapSource, /imageUrl:\s*overlay\.imageUrl/);
  assert.doesNotMatch(mapSource, /createGroundOverlayLayerFromBackend[\s\S]*createObjectURL/);
});
