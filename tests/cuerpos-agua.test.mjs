import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const data = JSON.parse(readFileSync(new URL("data/base/hidrografia/cuerpos-agua.geojson", root), "utf8"));
const map = readFileSync(new URL("js/map.js", root), "utf8");

test("cuerpos de agua conserva los 711 registros, atribución UAEM y cobertura Morelos", () => {
  assert.equal(data.type, "FeatureCollection");
  assert.equal(data.features.length, 711);
  const counts = new Map();
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (coordinates) => {
    if (typeof coordinates[0] === "number") {
      const [x, y] = coordinates;
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
      return;
    }
    coordinates.forEach(walk);
  };
  for (const feature of data.features) {
    counts.set(feature.geometry.type, (counts.get(feature.geometry.type) || 0) + 1);
    assert.equal(feature.properties.FUENTE, "Universidad Autónoma del Estado de Morelos");
    assert.equal(feature.properties.CVE_ENT, 17);
    walk(feature.geometry.coordinates);
  }
  assert.deepEqual([...counts], [["Polygon", 710], ["MultiPolygon", 1]]);
  assert.deepEqual(bounds, [-99.4854348, 18.3748604, -98.6644568, 19.0634431]);
});

test("la capa de agua es referencia independiente, visible y se restaura sin duplicarse", () => {
  assert.match(map, /id: "cuerpos-agua"[\s\S]*?category: "otras"[\s\S]*?visible: true/);
  assert.match(map, /upsertGeoJsonSource\("cuerpos-agua-source", state\.staticData\.cuerposAgua,/);
  assert.match(map, /addLayerIfMissing\(\{\s*id: "cuerpos-agua-fill"/);
  assert.match(map, /addLayerIfMissing\(\{\s*id: "cuerpos-agua-outline"/);
  assert.match(map, /setStaticVisibility\("cuerpos-agua"/);
  assert.match(map, /if \(layerId === "cuerpos-agua"\)/);
  assert.match(map, /Agua: INEGI \(origen\) · UAEM-FA \(archivo\)/);
  assert.match(map, /const institutionalSections = \[[\s\S]*?title:"Límites"[\s\S]*?title:"Cartografía"/);
  assert.match(map, /const thematicSections = groupLayersByDivision\([\s\S]*?elements\.layerList\.innerHTML = thematicSections \+ institutionalSections/);
  assert.match(map, /await state\.cloudTop\.mapLayer\.showFrame\(renderedFrame\);\s*ensureReferenceLayerOrder\(\)/);
});

test("el orden del catálogo es Peligro, Vulnerabilidad, Riesgo, Límites y Cartografía sin alterar el dibujo", () => {
  const catalog = map.slice(map.indexOf("function renderLayerCatalog(searchTerm"), map.indexOf("function renderLayerGroup("));
  assert.match(catalog, /thematicSections \+ institutionalSections/);
  assert.match(catalog, /\{id:"limites", title:"Límites"\}, \{id:"otras", title:"Cartografía"\}/);
  assert.doesNotMatch(catalog, /ensureReferenceLayerOrder\(/);
  assert.match(map, /const WATER_REFERENCE_LAYER_IDS = \["cuerpos-agua-fill", "cuerpos-agua-outline"\]/);
});

test("SE 02 procede del catálogo y no de una copia local productiva ni de un filtro especial", () => {
  const id = "cmuhd3t7b000vl3b11fge7gny";
  const api = readFileSync(new URL("js/app/services/layers-api.js", root), "utf8");
  const client = readFileSync(new URL("js/app/services/http-client.js", root), "utf8");
  assert.equal(existsSync(new URL(`uploads/processed/${id}/layer.geojson`, root)), false);
  assert.equal(existsSync(new URL(`data/base/${id}.geojson`, root)), false);
  assert.doesNotMatch(map, new RegExp(id));
  assert.match(map, /const publicLayers = await listPublicLayersRequest\(\)/);
  assert.match(api, /request\("\/layers\/public", \{/);
  assert.match(client, /method = "GET"/);
});

test("la opacidad temática es 75% para vectores, iconos y raster sin alterar colores", () => {
  assert.match(map, /const DEFAULT_THEMATIC_OPACITY = 0\.75/);
  assert.match(map, /opacity: clampLayerOpacity\(config\.opacity \?\? DEFAULT_THEMATIC_OPACITY\)/);
  for (const property of ["fill-opacity", "line-opacity", "circle-opacity", "icon-opacity", "raster-opacity"]) {
    assert.ok(map.includes(`"${property}"`), property);
  }
  assert.match(map, /opacity: clampLayerOpacity\(preference\?\.opacity \?\? layer\.opacity \?\? DEFAULT_THEMATIC_OPACITY\)/);
});
