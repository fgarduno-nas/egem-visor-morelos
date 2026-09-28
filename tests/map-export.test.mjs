import test from "node:test";
import assert from "node:assert/strict";
import { exportDate, metricScale, trackExportErrors, captureMap } from "../js/app/utils/map-export.js";
import { CloudTopMapLayer } from "../js/app/weather/cloud-top-layer.js";
import { exportGeometry, snapshotStyle, assertGoesCoverage } from "../js/app/utils/map-export-renderer.js";

test("formato 2047:1576 conserva ancho lógico y añade territorio vertical en paisaje", () => {
  const geometry = exportGeometry(1200, 500);
  assert.equal(geometry.width, 1200);
  assert.equal(geometry.height, Math.ceil(1200 * 1576 / 2047));
  assert.equal(Math.floor(geometry.width * geometry.pixelRatio), 2047);
  assert.ok(Math.floor(geometry.height * geometry.pixelRatio) >= 1576);
  assert.ok(exportGeometry(390, 754).height < 754, "portrait preserves horizontal extent, not full vertical extent");
});

test("la perspectiva conserva distancia focal y bloquea FOV fuera del límite", () => {
  const g = exportGeometry(1200, 600, 36.87, 30);
  const focal = height => height / 2 / Math.tan(36.87 * Math.PI / 360);
  assert.ok(Math.abs(g.height / 2 / Math.tan(g.fov * Math.PI / 360) - focal(600)) < 1e-8);
  assert.throws(() => exportGeometry(1800, 300, 36.87, 40), /inclinación/);
});

test("la instantánea excluye buffers invisibles y no modifica el estilo original", () => {
  const style = { version: 8, sources: { active: { type: "image" }, hidden: { type: "image" } }, layers: [
    { id: "current", source: "active", type: "raster", paint: { "raster-opacity": .62 } },
    { id: "previous", source: "hidden", type: "raster", paint: { "raster-opacity": 0 } },
  ] };
  const copy = snapshotStyle({ getStyle: () => style, getZoom: () => 8 });
  assert.deepEqual(Object.keys(copy.sources), ["active"]);
  assert.equal(copy.layers.length, 1);
  assert.equal(style.layers.length, 2);
});

test("GOES fuera de cobertura detiene la exportación con alternativa explícita", () => {
  const map = { getCanvas: () => ({ width: 2047, clientWidth: 2047 }), unproject: () => ({ lng: -105, lat: 18 }) };
  const style = { sources: { "cloud-top-animation-source-1": { type: "image", coordinates: [[-101,20],[-96,20],[-96,17],[-101,17]] } } };
  assert.throws(() => assertGoesCoverage(map, style, { y: 0 }), /Acerca el mapa o desactiva GOES/);
});

test("fecha y nombre usan México incluso al cambiar de día en UTC", () => {
  assert.deepEqual(exportDate(new Date("2026-09-26T01:49:00Z")), {
    label: "25/09/2026 · 19:49", filename: "EGEM_Morelos_2026-09-25_1949.png",
  });
  assert.equal(exportDate(new Date("2026-09-25T06:00:00Z")).label, "25/09/2026 · 00:00");
});

test("escala gráfica mantiene la distancia geográfica y no excede el tramo medido", () => {
  assert.deepEqual(metricScale(13600, 100), { label: "10 km", pixels: 1000000 / 13600 });
  assert.deepEqual(metricScale(43, 90), { label: "20 m", pixels: 1800 / 43 });
  assert.throws(() => metricScale(0, 100), /escala/);
});

function mockMap() {
  const listeners = new Map();
  const source = {};
  const map = {
    layers: [{ id: "tiles", source: "provider", type: "raster", paint: {} }], source,
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    off(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type, event = {}) { [...listeners.get(type) || []].forEach(fn => fn(event)); },
    getStyle() { return { layers: this.layers }; },
    getSource() { return this.source; }, getZoom() { return 8; },
    getCenter() { return { lng: -99, lat: 19 }; }, getBearing() { return 0; }, getPitch() { return 0; },
    getCanvas() { return { width: 800, height: 600, clientWidth: 800, clientHeight: 600 }; },
    stop() {}, triggerRepaint() {},
    dragPan: { enabled: true, isEnabled() { return this.enabled; }, disable() { this.enabled = false; }, enable() { this.enabled = true; } },
    listenerCount() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); },
  };
  return map;
}

test("tiles fallidos visibles bloquean; ocultos y fuentes recreadas no contaminan otras capturas", () => {
  const map = mockMap();
  const check = trackExportErrors(map);
  map.fire("error", { sourceId: "provider", error: new Error("https://proveedor/tile: CORS") });
  assert.throws(check, /provider.*CORS/);
  map.layers[0].layout = { visibility: "none" };
  assert.doesNotThrow(check);
  map.layers[0].layout.visibility = "visible";
  map.source = {};
  assert.doesNotThrow(check);
});

test("timeout libera interacción y todos los listeners", async () => {
  const map = mockMap();
  await assert.rejects(captureMap(map, { date: exportDate(), check() {}, timeoutMs: 5 }), /no terminó/);
  assert.equal(map.dragPan.enabled, true);
  assert.equal(map.listenerCount(), 0);
});

test("un logotipo fallido cancela la exportación y restituye la interacción", async () => {
  const map = mockMap();
  await assert.rejects(captureMap(map, {
    date: exportDate(), check() {},
    logo: Promise.reject(new Error("No se pudo cargar assets/encabezadoform.png")),
  }), /encabezadoform\.png/);
  assert.equal(map.dragPan.enabled, true);
  assert.equal(map.listenerCount(), 0);
});

test("cancelar o redimensionar durante carga libera la captura sin PNG", async () => {
  for (const event of ["abort", "resize"]) {
    const map = mockMap();
    const controller = new AbortController();
    const promise = captureMap(map, { date: exportDate(), check() {}, signal: controller.signal });
    if (event === "abort") controller.abort(); else map.fire("resize");
    await assert.rejects(promise, event === "abort" ? /cancelada/ : /vista cambió/);
    assert.equal(map.dragPan.enabled, true);
    assert.equal(map.listenerCount(), 0);
  }
});

test("GOES no intercambia buffers si termina una precarga durante la congelación", async () => {
  const layers = new Map();
  const map = {
    getLayer: id => layers.get(id),
    getPaintProperty: (id, name) => layers.get(id).paint[name],
    setPaintProperty: (id, name, value) => { layers.get(id).paint[name] = value; },
  };
  const layer = new CloudTopMapLayer(map, { opacity: .62 });
  layer.getLayerIds().forEach(id => layers.set(id, { paint: { "raster-opacity": .31 } }));
  let releaseLoad;
  layer.preloadFrame = () => new Promise(resolve => { releaseLoad = resolve; });
  const pending = layer.showFrame({ id: "next", url: "next.png", bounds: [-100,18,-98,20] });
  const restore = layer.freezeForExport();
  releaseLoad();
  await pending;
  assert.equal(layer.activeBuffer, 0);
  assert.equal(layers.get(layer.getLayerId(0)).paint["raster-opacity"], .62);
  assert.equal(layers.get(layer.getLayerId(1)).paint["raster-opacity"], 0);
  restore();
  assert.equal(layer.exportFrozen, false);
});
