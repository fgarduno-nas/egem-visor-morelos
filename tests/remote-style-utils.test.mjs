import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const modulePath = path.resolve("js/app/utils/remote-style-utils.js");
const moduleSource = await fs.readFile(modulePath, "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`;
const mapSource = await fs.readFile(path.resolve("js/map.js"), "utf8");
const cssSource = await fs.readFile(path.resolve("css/style.css"), "utf8");
const htmlSource = await fs.readFile(path.resolve("index.html"), "utf8");
const municipiosGeojson = JSON.parse(await fs.readFile(path.resolve("data/base/municipios.geojson"), "utf8"));
const municipiosLabelPoints = JSON.parse(await fs.readFile(path.resolve("data/base/municipios_label_points.geojson"), "utf8"));
const localidadesMorelos = JSON.parse(await fs.readFile(path.resolve("data/base/localidades_morelos.geojson"), "utf8"));
const vialidadesNivel1 = JSON.parse(await fs.readFile(path.resolve("data/base/vialidades/vialidades_nivel_1.geojson"), "utf8"));
const vialidadesNivel2 = JSON.parse(await fs.readFile(path.resolve("data/base/vialidades/vialidades_nivel_2.geojson"), "utf8"));
const vialidadesNivel3Manifest = JSON.parse(await fs.readFile(path.resolve("data/base/vialidades/vialidades_nivel_3_manifest.json"), "utf8"));
const vialidadesNameDiagnostic = JSON.parse(await fs.readFile(path.resolve("data/base/vialidades/diagnostico_nombres_viales.json"), "utf8"));
const vialidadesNameCorrections = JSON.parse(await fs.readFile(path.resolve("data/base/vialidades/correcciones_nombres_viales.json"), "utf8"));
const vialidadesDisplayNames = JSON.parse(await fs.readFile(path.resolve("data/base/vialidades/nombres_viales_mostrar.json"), "utf8"));
const officialMunicipalPopulation2020 = new Map([
  ["17001", 17598],
  ["17002", 25232],
  ["17003", 39174],
  ["17004", 89834],
  ["17005", 10520],
  ["17006", 187118],
  ["17007", 378476],
  ["17008", 107053],
  ["17009", 24515],
  ["17010", 18402],
  ["17011", 215357],
  ["17012", 57682],
  ["17013", 16694],
  ["17014", 9653],
  ["17015", 15802],
  ["17016", 19219],
  ["17017", 40018],
  ["17018", 122263],
  ["17019", 28122],
  ["17020", 54987],
  ["17021", 7617],
  ["17022", 14853],
  ["17023", 7943],
  ["17024", 52399],
  ["17025", 33789],
  ["17026", 19408],
  ["17027", 12750],
  ["17028", 73539],
  ["17029", 105780],
  ["17030", 56083],
  ["17031", 36094],
  ["17032", 9965],
  ["17033", 16574],
  ["17034", 11347],
  ["17035", 27805],
  ["17036", 7855],
]);
const priorityMunicipalityNames = new Set(["Cuernavaca", "Cuautla", "Jojutla", "Xochitepec", "Jiutepec", "Emiliano Zapata"]);

const {
  analyzeStyleField,
  buildInstitutionalHazardLegend,
  buildContinuousClassification,
  buildStepExpression,
  containsHtmlMarkup,
  getInstitutionalHazardLabel,
  isInstitutionalHazardField,
  isPresentValue,
  toFiniteNumber,
} = await import(moduleUrl);

function feature(properties) {
  return { type: "Feature", properties, geometry: { type: "Point", coordinates: [0, 0] } };
}

function extractFunctionSource(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `No se encontro ${name}`);
  const start = match.index;
  let parenDepth = 0;
  let signatureEnd = -1;
  for (let index = source.indexOf("(", start); index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (parenDepth === 0) {
      signatureEnd = index;
      break;
    }
  }
  const openBrace = source.indexOf("{", signatureEnd);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`No se pudo extraer ${name}`);
}

function normalizeTestLabelName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:()[\]{}'"’`´_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function walkCoordinatePairs(coordinates, callback) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === "number") {
    callback(coordinates);
    return;
  }
  coordinates.forEach((child) => walkCoordinatePairs(child, callback));
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
    if (
      Math.abs(cross) < 1e-12 &&
      x >= Math.min(x1, x2) - 1e-12 &&
      x <= Math.max(x1, x2) + 1e-12 &&
      y >= Math.min(y1, y2) - 1e-12 &&
      y <= Math.max(y1, y2) + 1e-12
    ) {
      return true;
    }
    if ((y1 > y) !== (y2 > y)) {
      const intersectionX = ((x2 - x1) * (y - y1)) / (y2 - y1) + x1;
      if (x < intersectionX) inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!pointInRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function pointInFeature(point, featureItem) {
  const { geometry } = featureItem;
  if (geometry.type === "Polygon") return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  }
  return false;
}

test("preserva cero como valor valido y descarta null/cadenas vacias", () => {
  assert.equal(isPresentValue(0), true);
  assert.equal(isPresentValue("0"), true);
  assert.equal(isPresentValue(null), false);
  assert.equal(isPresentValue(undefined), false);
  assert.equal(isPresentValue(""), false);
  assert.equal(isPresentValue("   "), false);
});

test("convierte numeros en cadena de forma segura", () => {
  assert.equal(toFiniteNumber("0.0380952380953"), 0.0380952380953);
  assert.equal(toFiniteNumber("0,4"), 0.4);
  assert.equal(toFiniteNumber("abc"), null);
});

test("detecta IVS_FINAL como numerico continuo", () => {
  const features = Array.from({ length: 100 }, (_item, index) => feature({ IVS_FINAL: index / 100 }));
  const analysis = analyzeStyleField(features, "IVS_FINAL");
  assert.equal(analysis.type, "continuous");
  assert.equal(analysis.validCount, 100);
  assert.equal(analysis.uniqueCount, 100);
});

test("mantiene texto con pocos valores como categorico", () => {
  const features = ["Alto", "Medio", "Bajo", "Alto"].map((Nivel) => feature({ Nivel }));
  const analysis = analyzeStyleField(features, "Nivel");
  assert.equal(analysis.type, "categorical");
});

test("mantiene codigos numericos discretos como categoricos", () => {
  const features = Array.from({ length: 40 }, (_item, index) => feature({ Codigo: index % 3 }));
  const analysis = analyzeStyleField(features, "Codigo");
  assert.equal(analysis.type, "categorical");
});

test("calcula cinco clases cuando la distribucion lo permite", () => {
  const classification = buildContinuousClassification("IVS_FINAL", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(classification.type, "continuous");
  assert.equal(classification.legend.length, 5);
  assert.equal(classification.cuts.length, 4);
});

test("usa intervalos iguales cuando cuantiles producen cortes duplicados", () => {
  const classification = buildContinuousClassification("IVS_FINAL", [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.equal(classification.method, "equal-interval");
  assert.equal(classification.cuts.every((cut, index) => index === 0 || cut > classification.cuts[index - 1]), true);
});

test("usa intervalos iguales cuando el primer cuantil coincide con el minimo", () => {
  const classification = buildContinuousClassification("IVS_FINAL", [0, 0, 0, 0, 0.03, 0.08, 0.14, 0.2, 0.3, 0.34]);
  assert.equal(classification.method, "equal-interval");
  assert.equal(classification.cuts[0] > 0, true);
});

test("todos los valores iguales no producen error", () => {
  const classification = buildContinuousClassification("IVS_FINAL", [0.5, 0.5, 0.5]);
  assert.equal(classification.type, "single");
  assert.equal(classification.legend.length, 1);
});

test("construye expresion step sin color default de capa", () => {
  assert.deepEqual(buildStepExpression("IVS_FINAL", [0.2, 0.4, 0.6, 0.8]), [
    "step",
    ["to-number", ["get", "IVS_FINAL"]],
    "#006100",
    0.2,
    "#7aab00",
    0.4,
    "#ffff00",
    0.6,
    "#ff9900",
    0.8,
    "#ff2200",
  ]);
});

test("detecta valores HTML para descartarlos de simbologia", () => {
  assert.equal(containsHtmlMarkup("<table><tr><td>A</td></tr></table>"), true);
  assert.equal(containsHtmlMarkup("Muy Alto"), false);
});

test("normaliza clasificacion cualitativa institucional de peligro", () => {
  assert.equal(getInstitutionalHazardLabel(" MUY_ALTO "), "Muy alto");
  assert.equal(getInstitutionalHazardLabel("Peligro: bajo"), "Bajo");
  assert.equal(getInstitutionalHazardLabel("3"), "Medio");
  assert.equal(isInstitutionalHazardField("Fen_Clasif"), true);
});

test("leyenda institucional usa solo etiquetas autorizadas y orden descendente", () => {
  const legend = buildInstitutionalHazardLegend(["Bajo 0-20", "Muy Alto (m/s)", "medio", "alto"]);
  assert.deepEqual(
    legend.classes.map((item) => item.label),
    ["Muy alto", "Alto", "Medio", "Bajo"]
  );
  assert.equal(legend.classes.some((item) => /0-20|m\/s|\(/i.test(item.label)), false);
});

test("la interfaz publica no renderiza textos tecnicos ni marca anterior", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  const visibleText = html
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<input[\s\S]*?>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/g, " ");

  assert.match(visibleText, /Atlas del Estado de Morelos/);
  assert.doesNotMatch(visibleText, /EGEM|Estado de operacion|Estado del sistema|Publicado|KMZ|Visualizable|Referencia/u);
  assert.doesNotMatch(visibleText, /Visualizador cartografico|Visualizador cartográfico|MapLibre GL JS/u);
  assert.match(visibleText, /Coordinación Estatal de Protección Civil Morelos/);
  assert.match(visibleText, /Universidad Autónoma del Estado de Morelos/);
});

test("el aviso institucional de version de prueba se muestra en cada carga sin persistencia", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  const setupSource = extractFunctionSource(mapSource, "setupUi");
  const showSource = extractFunctionSource(mapSource, "showTrialNoticeModal");
  const closeSource = extractFunctionSource(mapSource, "closeTrialNoticeModal");
  const focusSource = extractFunctionSource(mapSource, "restoreViewerFocus");

  assert.match(html, /id="trial-notice-modal"/);
  assert.equal((html.match(/id="trial-notice-modal"/g) || []).length, 1);
  assert.equal((html.match(/id="territorial-query-modal"/g) || []).length, 1);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="trial-notice-title"/);
  assert.match(html, /aria-describedby="trial-notice-message"/);
  assert.match(html, /id="trial-notice-title">Visualizador en versión de prueba<\/h2>/);
  assert.match(html, /Este visualizador se encuentra actualmente en etapa de prueba y construcción\. Algunas funciones, capas o contenidos pueden cambiar durante su desarrollo\./);
  assert.match(html, /id="accept-trial-notice"[^>]*>Entendido<\/button>/);
  assert.match(html, /id="close-trial-notice"[^>]*aria-label="Cerrar aviso de versión de prueba"/);
  assert.match(html, /<div class="app-shell" tabindex="-1">/);
  assert.match(cssSource, /\.modal--trial-notice\s*\{/);
  assert.match(cssSource, /\.modal--trial-notice::backdrop\s*\{/);
  assert.match(cssSource, /\.modal-card--trial-notice\s*\{/);

  assert.match(mapSource, /map\.on\("load", async \(\) => \{[\s\S]{0,120}showTrialNoticeModal\(\);/);
  assert.match(showSource, /trialNoticeModal\.showModal\(\)/);
  assert.match(showSource, /acceptTrialNotice\?\.focus\(\)/);
  assert.match(setupSource, /acceptTrialNotice\?\.addEventListener\("click", closeTrialNoticeModal\)/);
  assert.match(setupSource, /closeTrialNotice\?\.addEventListener\("click", closeTrialNoticeModal\)/);
  assert.match(setupSource, /event\.target === elements\.trialNoticeModal/);
  assert.match(setupSource, /trialNoticeModal\?\.addEventListener\("close", restoreViewerFocus\)/);
  assert.match(closeSource, /trialNoticeModal\.close\(\)/);
  assert.match(focusSource, /document\.querySelector\("\.app-shell"\)/);
  assert.match(focusSource, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(showSource + closeSource, /localStorage|sessionStorage|cookie/);
  assert.doesNotMatch(showSource + closeSource, /toggleLayerVisibility|openFloatingLegendForLayer|closeFloatingLegend|fetch|listPublicLayersRequest|ensureLayerResourcesLoaded/);
});

test("el panel compacto GOES IR no afirma lluvia ni radiacion UV", () => {
  const setupGoesSource = extractFunctionSource(mapSource, "setupCloudTopPanel");
  const renderGoesSource = extractFunctionSource(mapSource, "renderCloudTopPanel");

  assert.match(setupGoesSource, /<strong>GOES<\/strong>/);
  assert.match(setupGoesSource, /id="goes-ir-toggle"/);
  assert.match(setupGoesSource, /aria-pressed="true"/);
  assert.match(setupGoesSource, /Infrarrojo de nubes/);
  assert.match(setupGoesSource, /NOAA nowCOAST/);
  assert.match(mapSource, /No representa lluvia directa/);
  assert.match(renderGoesSource, /setAttribute\(\s*"aria-label"/);
  assert.doesNotMatch(setupGoesSource, /lluvia/);
  assert.doesNotMatch(setupGoesSource, /radiaci/);
});

test("la auditoría ortográfica no deja variantes visibles conocidas sin acento", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  const weatherEnhancement = await fs.readFile(path.resolve("js/app/weather/cloud-top-enhancement.js"), "utf8");
  const weatherLayer = await fs.readFile(path.resolve("js/app/weather/cloud-top-layer.js"), "utf8");
  const weatherProvider = await fs.readFile(path.resolve("js/app/weather/cloud-top-provider.js"), "utf8");
  const groundOverlay = await fs.readFile(path.resolve("js/app/utils/ground-overlay-popup-utils.js"), "utf8");
  const visibleSources = [
    html,
    mapSource,
    weatherEnhancement,
    weatherLayer,
    weatherProvider,
    groundOverlay,
  ].join("\n");
  const forbiddenVisibleVariants = [
    "Referencia termica de nubosidad y topes frios",
    "Actualizacion satelital",
    "Ultima actualizacion",
    "Menor senal",
    "Mayor senal IR",
    "radiacion UV",
    "contrasena",
    "medicion",
    "ubicacion.",
  ];
  forbiddenVisibleVariants.forEach((variant) => {
    assert.doesNotMatch(visibleSources, new RegExp(escapeRegExp(variant)));
  });
  assert.match(visibleSources, /Menú/);
  assert.match(visibleSources, /Consulta rápida territorial/);
  assert.match(visibleSources, /Longitud:[\s\S]*Latitud:[\s\S]*WGS 84/);
  assert.match(visibleSources, /Última actualización/);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("el popup puede recuperar properties desde capas hermanas renderizadas", () => {
  assert.match(mapSource, /function getClickedVectorFeature/);
  assert.match(mapSource, /queryRenderedFeatures\(event\.point, \{ layers: layerIds \}\)/);
});

test("el listener de click evita registrarse multiples veces", () => {
  assert.match(mapSource, /map\[`__bound_\$\{layerId\}`\]/);
});

test("la simbologia remota conserva __styleFill existente", () => {
  assert.match(mapSource, /Se conserva __styleFill/);
  assert.match(mapSource, /if \(properties\.__styleFill\)/);
});

test("el selector de fondos usa un boton accesible y no duplica listeners globales", async () => {
  assert.match(htmlSource, /<div class="basemap-control">\s*<button[\s\S]*id="toolbar-basemap"/);
  assert.match(htmlSource, /id="toolbar-basemap"[\s\S]*<\/button>\s*<div class="basemap-flyout" id="basemap-flyout" hidden>/);
  assert.match(htmlSource, /aria-label="Elegir fondo cartográfico"/);
  assert.match(htmlSource, /id="basemap-flyout"/);
  assert.doesNotMatch(htmlSource, /id="basemap-panel"/);
  assert.doesNotMatch(htmlSource, /id="basemap-list"/);
  assert.equal((htmlSource.match(/id="basemap-flyout"/g) || []).length, 1);
  assert.equal((htmlSource.match(/class="basemap-list/g) || []).length, 1);
  assert.equal((mapSource.match(/toolbarBasemap\?\..*addEventListener\("click"/g) || []).length, 1);
  assert.match(mapSource, /function openBasemapFlyout/);
  assert.match(mapSource, /function closeBasemapFlyout/);
  assert.match(mapSource, /function resetBasemapFlyoutPositionProperties/);
  assert.doesNotMatch(mapSource, /function positionBasemapFlyout/);
  assert.doesNotMatch(mapSource, /calculateBasemapFlyoutPosition/);
  assert.doesNotMatch(mapSource, /toolbarBasemap\.getBoundingClientRect\(\)/);
  assert.doesNotMatch(mapSource, /orientationchange/);
  assert.doesNotMatch(mapSource, /queueBasemapFlyoutReposition/);
  assert.match(mapSource, /event\.key === "Escape" && elements\.basemapFlyout/);
  assert.match(mapSource, /!elements\.basemapFlyout\.contains\(event\.target\)/);
  assert.match(mapSource, /state\.activeBaseMap = event\.target\.value/);
  assert.equal((mapSource.match(/window\.addEventListener\("resize"/g) || []).length, 1);
  ["satellite", "topographic", "light", "dark"].forEach((thumbnail) => {
    assert.match(mapSource, new RegExp(`thumbnail: "${thumbnail}"`));
    assert.match(cssSource, new RegExp(`basemap-option__thumb--${thumbnail}`));
  });
});

test("la base satelital no carga la referencia Esri de etiquetas y contornos", () => {
  const baseMapConfigSource = mapSource.match(/const baseMapConfigs = \{(?<body>[\s\S]*?)\n  \};/u)?.groups.body || "";
  const createBaseMapStyleSource = extractFunctionSource(mapSource, "createBaseMapStyle");
  const applyBaseMapVisibilitySource = extractFunctionSource(mapSource, "applyBaseMapVisibility");

  assert.match(baseMapConfigSource, /satelite:\s*\[[\s\S]*sourceId: "satellite-source"/);
  assert.doesNotMatch(baseMapConfigSource, /basemap-satelite-labels/);
  assert.doesNotMatch(baseMapConfigSource, /World_Boundaries_and_Places/);
  assert.doesNotMatch(mapSource, /Reference\/World_Boundaries_and_Places/);
  assert.match(createBaseMapStyleSource, /sources\[entry\.sourceId\] = entry\.source/);
  assert.match(applyBaseMapVisibilitySource, /safeSetLayoutProperty\(entry\.layerId, "visibility", visibility\)/);
});

test("la capa municipal oficial se carga una sola vez y conserva contrato MapLibre", () => {
  const staticSource = extractFunctionSource(mapSource, "injectStaticSources");
  const baseDataSource = extractFunctionSource(mapSource, "loadStaticData");
  const municipioLayerIds = ["municipios-source", "municipios-hit", "municipios"];

  assert.match(baseDataSource, /fetch\("data\/base\/municipios\.geojson"\)/);
  assert.equal((staticSource.match(/upsertGeoJsonSource\("municipios-source"/g) || []).length, 1);
  assert.equal((staticSource.match(/id: "municipios-hit"/g) || []).length, 1);
  assert.equal((staticSource.match(/id: "municipios"/g) || []).length, 1);
  municipioLayerIds.forEach((id) => assert.match(staticSource, new RegExp(id)));
  assert.match(staticSource, /source: "municipios-source"/);
  assert.match(staticSource, /"fill-opacity": 0\.01/);
  assert.match(mapSource, /const MUNICIPAL_BOUNDARY_COLOR = "#9ca3af";/);
  assert.match(mapSource, /const MUNICIPAL_BOUNDARY_WIDTH = \["interpolate", \["linear"\], \["zoom"\], 6, 0\.55, 10, 0\.8, 14, 1\.1\];/);
  assert.match(mapSource, /const MUNICIPAL_BOUNDARY_OPACITY = 0\.82;/);
  assert.match(staticSource, /"line-color": MUNICIPAL_BOUNDARY_COLOR/);
  assert.match(staticSource, /"line-width": MUNICIPAL_BOUNDARY_WIDTH/);
  assert.match(staticSource, /"line-opacity": MUNICIPAL_BOUNDARY_OPACITY \* getLayerOpacity/);
  const hitLayerSource = staticSource.match(/id: "municipios-hit"[\s\S]*?\}\);/u)?.[0] || "";
  assert.doesNotMatch(hitLayerSource, /MUNICIPAL_BOUNDARY_COLOR|"line-color"|"line-width"/);
});

test("el GeoJSON municipal oficial usa WGS84, 36 municipios y geometria no vacia", () => {
  const names = municipiosGeojson.features.map((featureItem) => featureItem.properties.NOMGEO);
  const uniqueNames = new Set(names);
  let coordinateCount = 0;
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];

  assert.equal(municipiosGeojson.type, "FeatureCollection");
  assert.equal(municipiosGeojson.features.length, 36);
  assert.equal(uniqueNames.size, 36);
  ["Coatetelco", "Hueyapan", "Xoxocotla"].forEach((name) => assert.ok(uniqueNames.has(name)));
  municipiosGeojson.features.forEach((featureItem) => {
    assert.ok(["Polygon", "MultiPolygon"].includes(featureItem.geometry?.type));
    assert.ok(Array.isArray(featureItem.geometry?.coordinates));
    assert.ok(featureItem.geometry.coordinates.length > 0);
    walkCoordinatePairs(featureItem.geometry.coordinates, ([lon, lat]) => {
      coordinateCount += 1;
      assert.ok(lon >= -180 && lon <= 180);
      assert.ok(lat >= -90 && lat <= 90);
      bbox[0] = Math.min(bbox[0], lon);
      bbox[1] = Math.min(bbox[1], lat);
      bbox[2] = Math.max(bbox[2], lon);
      bbox[3] = Math.max(bbox[3], lat);
    });
  });
  assert.equal(coordinateCount, 42150);
  assert.ok(bbox[0] > -100 && bbox[2] < -98);
  assert.ok(bbox[1] > 18 && bbox[3] < 20);
});

test("el encabezado usa un único menú de acciones sin botones distribuidos", async () => {
  const topbarActions = htmlSource.match(/<div class="topbar-actions">(?<body>[\s\S]*?)<\/div>\s*<div class="topbar-compact-menu"/u)?.groups.body || "";
  const menu = htmlSource.match(/<div class="topbar-compact-menu"(?<body>[\s\S]*?)<\/div>/u)?.groups.body || "";
  const menuItemIds = ["toggle-sidebar", "compact-open-territorial-query", "open-help", "open-user-admin", "logout-session", "open-login"];

  assert.equal((htmlSource.match(/topbar-menu-toggle__label">Menú/g) || []).length, 1);
  assert.doesNotMatch(htmlSource, /class="topbar-compact-actions"/);
  assert.match(topbarActions, /id="toggle-topbar"/);
  assert.match(topbarActions, /id="toggle-compact-menu"/);
  menuItemIds.forEach((id) => assert.doesNotMatch(topbarActions, new RegExp(`id="${id}"`)));
  menuItemIds.forEach((id) => assert.match(menu, new RegExp(`id="${id}"`)));
  assert.match(menu, /Consulta rápida territorial/);
  assert.match(mapSource, /function handleCompactMenuKeydown/);
  assert.match(mapSource, /document\.getElementById\("open-login"\)\?\.classList\.toggle\("hidden", state\.session\.isAuthenticated\)/);
});

test("el encabezado contiene un unico aviso Version de prueba no interactivo", () => {
  const badgeMarkup = htmlSource.match(/<span class="trial-version-badge"[^>]*>Versión de prueba<\/span>/u)?.[0] || "";
  const visibleOccurrences = htmlSource.match(/>Versión de prueba<\/span>/g) || [];

  assert.equal(visibleOccurrences.length, 1);
  assert.match(badgeMarkup, /aria-label="Versión de prueba"/);
  assert.doesNotMatch(badgeMarkup, /button|href|role="button"|tabindex/u);
  assert.match(cssSource, /\.trial-version-badge\s*\{/);
  assert.match(cssSource, /\.app-shell--topbar-collapsed \.brand-title-row\s*\{/);
});

test("el menu de fondos queda anclado estructuralmente al boton real", () => {
  const controlRule = Array.from(cssSource.matchAll(/^\.basemap-control\s*\{(?<body>[\s\S]*?)\n\}/gmu)).find((match) =>
    match.groups?.body.includes("position: relative")
  );
  const flyoutRule = cssSource.match(/^\.basemap-flyout\s*\{(?<body>[\s\S]*?)\n\}/mu);
  assert.ok(controlRule?.groups?.body);
  assert.ok(flyoutRule?.groups?.body);

  assert.match(controlRule.groups.body, /position:\s*relative/);
  assert.match(controlRule.groups.body, /overflow:\s*visible/);
  assert.match(flyoutRule.groups.body, /position:\s*absolute/);
  assert.match(flyoutRule.groups.body, /top:\s*calc\(100% \+ 8px\)/);
  assert.match(flyoutRule.groups.body, /left:\s*0/);
  assert.match(flyoutRule.groups.body, /z-index:\s*40/);
  assert.doesNotMatch(mapSource, /document\.querySelector\("\.map-stage"\)\?\.getBoundingClientRect\(\)/);
  assert.doesNotMatch(mapSource, /setProperty\("--basemap-flyout-(left|top|width)/);
});

test("el flyout no conserva reglas residuales que lo empujen fuera de la alineacion", () => {
  const flyoutRule = cssSource.match(/\.basemap-flyout\s*\{(?<body>[\s\S]*?)\n\}/u);
  assert.ok(flyoutRule?.groups?.body);
  assert.match(flyoutRule.groups.body, /right:\s*auto/);
  assert.match(flyoutRule.groups.body, /bottom:\s*auto/);
  assert.match(flyoutRule.groups.body, /inset:\s*auto/);
  assert.match(flyoutRule.groups.body, /transform:\s*none/);
  assert.match(flyoutRule.groups.body, /translate:\s*none/);
  ["left", "right", "top", "bottom", "inset", "transform", "translate"].forEach((property) => {
    assert.match(mapSource, new RegExp(`"${property}"`));
  });
  assert.match(mapSource, /removeProperty\(property\)/);
});

test("el limite estatal resaltado se define una sola vez y se restaura al frente", () => {
  const cssAccent = cssSource.match(/--accent:\s*(#[0-9a-f]{6});/iu)?.[1]?.toLowerCase();

  assert.equal(cssAccent, "#7a203a");
  assert.match(mapSource, /const INSTITUTIONAL_BOUNDARY_COLOR = "#7a203a";/);
  assert.match(mapSource, /const STATE_BOUNDARY_HALO_COLOR = "#fff7ef";/);
  assert.match(mapSource, /const STATE_BOUNDARY_BASE_WIDTH = \["interpolate", \["linear"\], \["zoom"\], 6, 2\.8, 10, 3\.8, 14, 5\.2\];/);
  assert.match(mapSource, /const STATE_BOUNDARY_HALO_WIDTH = \["interpolate", \["linear"\], \["zoom"\], 6, 4\.2, 10, 5\.8, 14, 7\.4\];/);
  assert.match(mapSource, /const STATE_BOUNDARY_HIGHLIGHT_WIDTH = \["interpolate", \["linear"\], \["zoom"\], 6, 2\.1, 10, 3\.2, 14, 4\.6\];/);
  assert.match(mapSource, /estado-highlight-halo/);
  assert.match(mapSource, /estado-highlight/);
  assert.match(mapSource, /"line-color": INSTITUTIONAL_BOUNDARY_COLOR/);
  assert.match(mapSource, /"line-color": STATE_BOUNDARY_HALO_COLOR/);
  assert.match(mapSource, /function restoreStateBoundaryHighlight/);
  assert.match(mapSource, /const visible = staticLayers\.find\(\(layer\) => layer\.id === "estado"\)\?\.visible !== false/);
  assert.match(mapSource, /safeSetLayoutProperty\("estado-highlight-halo", "visibility", visible \? "visible" : "none"\)/);
  assert.match(mapSource, /safeSetLayoutProperty\("estado-highlight", "visibility", visible \? "visible" : "none"\)/);
  assert.match(mapSource, /map\.moveLayer\(layerId\)/);
});

test("los limites mantienen estado inicial activo y jerarquia visual independiente de capas tematicas", () => {
  const staticSource = extractFunctionSource(mapSource, "injectStaticSources");
  const opacitySource = extractFunctionSource(mapSource, "applyStaticLayerOpacity");
  const staticLayerBlock = mapSource.match(/const staticLayers = \[(?<body>[\s\S]*?)\n  \];/u)?.groups.body || "";

  assert.match(staticLayerBlock, /id: "estado"[\s\S]*?visible: true/);
  assert.match(staticLayerBlock, /id: "municipios"[\s\S]*?visible: true/);
  assert.equal((staticSource.match(/source: "estado-source"/g) || []).length, 4);
  assert.equal((staticSource.match(/source: "municipios-source"/g) || []).length, 2);
  assert.equal((staticSource.match(/id: "municipios-hit"/g) || []).length, 1);
  assert.equal((staticSource.match(/id: "municipios"/g) || []).length, 1);
  assert.equal((staticSource.match(/id: "estado-highlight"/g) || []).length, 1);
  assert.match(staticSource, /"line-width": STATE_BOUNDARY_HIGHLIGHT_WIDTH/);
  assert.match(staticSource, /"line-width": MUNICIPAL_BOUNDARY_WIDTH/);
  assert.doesNotMatch(staticSource, /state\.userLayers|activeLayer|selectedLayer|thematic/);
  assert.match(opacitySource, /safeSetPaintProperty\("estado-highlight", "line-opacity", opacity\)/);
  assert.match(opacitySource, /safeSetPaintProperty\("municipios", "line-opacity", MUNICIPAL_BOUNDARY_OPACITY \* opacity\)/);
});

test("los puntos derivados de etiquetas municipales son 36 puntos validos dentro de su municipio", () => {
  assert.equal(municipiosLabelPoints.type, "FeatureCollection");
  assert.equal(municipiosLabelPoints.metadata.source, "data/base/municipios.geojson");
  assert.match(municipiosLabelPoints.metadata.populationSource, /INEGI Censo de Poblacion y Vivienda 2020/);
  assert.match(municipiosLabelPoints.metadata.populationSource, /LOC=0000/);
  assert.match(municipiosLabelPoints.metadata.populationSource, /POBTOT/);
  assert.equal(municipiosLabelPoints.features.length, 36);

  const seenCvegeo = new Set();
  const municipiosByCvegeo = new Map(municipiosGeojson.features.map((featureItem) => [featureItem.properties.CVEGEO, featureItem]));
  municipiosLabelPoints.features.forEach((featureItem) => {
    assert.equal(featureItem.geometry.type, "Point");
    assert.equal(featureItem.geometry.coordinates.length, 2);
    assert.ok(Number.isFinite(featureItem.geometry.coordinates[0]));
    assert.ok(Number.isFinite(featureItem.geometry.coordinates[1]));
    assert.ok(featureItem.properties.NOMGEO?.trim());
    assert.ok(featureItem.properties.CVEGEO?.trim());
    assert.equal(`${featureItem.properties.CVE_ENT}${featureItem.properties.CVE_MUN}`, featureItem.properties.CVEGEO);
    assert.equal(featureItem.properties.population, officialMunicipalPopulation2020.get(featureItem.properties.CVEGEO));
    assert.equal(Number.isInteger(featureItem.properties.population), true);
    assert.ok(featureItem.properties.population > 0);
    assert.ok(Number.isInteger(featureItem.properties.labelTier));
    assert.ok(featureItem.properties.labelTier >= 1 && featureItem.properties.labelTier <= 5);
    assert.ok(Number.isInteger(featureItem.properties.labelPriority));
    assert.ok(featureItem.properties.labelPriority >= 1 && featureItem.properties.labelPriority <= 36);
    assert.equal(seenCvegeo.has(featureItem.properties.CVEGEO), false);
    seenCvegeo.add(featureItem.properties.CVEGEO);
    assert.equal(pointInFeature(featureItem.geometry.coordinates, municipiosByCvegeo.get(featureItem.properties.CVEGEO)), true);
  });
  assert.equal(seenCvegeo.size, officialMunicipalPopulation2020.size);

  ["Coatetelco", "Hueyapan", "Xoxocotla"].forEach((name) => {
    assert.ok(municipiosLabelPoints.features.some((featureItem) => featureItem.properties.NOMGEO === name), name);
  });
});

test("los tiers municipales son progresivos y se basan en poblacion oficial", () => {
  const byName = new Map(municipiosLabelPoints.features.map((featureItem) => [featureItem.properties.NOMGEO, featureItem.properties]));
  const byTier = new Map([1, 2, 3, 4, 5].map((tier) => [tier, []]));

  municipiosLabelPoints.features.forEach((featureItem) => {
    const props = featureItem.properties;
    byTier.get(props.labelTier).push(props);
    if (priorityMunicipalityNames.has(props.NOMGEO)) {
      assert.equal(props.labelTier, 1, props.NOMGEO);
    } else if (props.population >= 100000) {
      assert.equal(props.labelTier, 2, props.NOMGEO);
    } else if (props.population >= 50000) {
      assert.equal(props.labelTier, 3, props.NOMGEO);
    } else if (props.population >= 25000) {
      assert.equal(props.labelTier, 4, props.NOMGEO);
    } else {
      assert.equal(props.labelTier, 5, props.NOMGEO);
    }
  });

  ["Cuernavaca", "Cuautla", "Jojutla", "Xochitepec", "Jiutepec", "Emiliano Zapata"].forEach((name) => {
    assert.equal(byName.get(name)?.labelTier, 1, name);
  });
  assert.deepEqual(byTier.get(2).map((props) => props.NOMGEO).sort(), ["Temixco", "Yautepec"]);
  assert.deepEqual(byTier.get(3).map((props) => props.NOMGEO).sort(), ["Ayala", "Tepoztlán", "Tlaltizapán de Zapata", "Yecapixtla"].sort());
  assert.deepEqual(byTier.get(4).map((props) => props.NOMGEO).sort(), [
    "Atlatlahucan",
    "Axochiapan",
    "Puente de Ixtla",
    "Tepalcingo",
    "Tlaquiltenango",
    "Xoxocotla",
    "Zacatepec",
  ].sort());

  const priorities = municipiosLabelPoints.features.map((featureItem) => featureItem.properties.labelPriority);
  assert.equal(new Set(priorities).size, 36);
  assert.deepEqual([...priorities].sort((a, b) => a - b), Array.from({ length: 36 }, (_, index) => index + 1));

  const ordered = [...municipiosLabelPoints.features]
    .map((featureItem) => featureItem.properties)
    .sort((left, right) => left.labelPriority - right.labelPriority);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    assert.ok(previous.labelTier <= current.labelTier);
    if (previous.labelTier === current.labelTier) {
      assert.ok(previous.population >= current.population);
    }
  }
});

test("las etiquetas municipales usan layer symbol automatica sin popups ni controles nuevos", () => {
  const staticSource = extractFunctionSource(mapSource, "injectStaticSources");
  const orderSource = extractFunctionSource(mapSource, "ensureReferenceLayerOrder");
  const visibleSnapshotSource = extractFunctionSource(mapSource, "captureVisibleSnapshot");
  const popupSource = extractFunctionSource(mapSource, "bindMunicipiosPopup");

  assert.match(mapSource, /const MUNICIPAL_LABEL_SOURCE_ID = "municipios-labels-source";/);
  assert.doesNotMatch(mapSource, /const MUNICIPAL_LABEL_LAYER_ID = "municipios-labels";/);
  assert.doesNotMatch(mapSource, /const MUNICIPAL_LABEL_MIN_ZOOM = 11\.8;/);
  assert.match(mapSource, /const MUNICIPAL_LABEL_TIERS = Object\.freeze\(\[/);
  assert.match(mapSource, /\{ id: "municipios-label-tier-1", tier: 1, minZoom: 8\.6 \}/);
  assert.match(mapSource, /\{ id: "municipios-label-tier-2", tier: 2, minZoom: 9\.3 \}/);
  assert.match(mapSource, /\{ id: "municipios-label-tier-3", tier: 3, minZoom: 9\.8 \}/);
  assert.match(mapSource, /\{ id: "municipios-label-tier-4", tier: 4, minZoom: 10\.7 \}/);
  assert.match(mapSource, /\{ id: "municipios-label-tier-5", tier: 5, minZoom: 11\.4 \}/);
  assert.match(mapSource, /fetch\("data\/base\/municipios_label_points\.geojson"\)/);
  assert.match(staticSource, /upsertGeoJsonSource\(MUNICIPAL_LABEL_SOURCE_ID, state\.staticData\.municipiosLabels\)/);
  assert.equal((staticSource.match(/MUNICIPAL_LABEL_TIERS\.forEach/g) || []).length, 1);
  assert.equal((staticSource.match(/id: labelTier\.id/g) || []).length, 1);
  assert.match(staticSource, /type: "symbol"/);
  assert.match(staticSource, /source: MUNICIPAL_LABEL_SOURCE_ID/);
  assert.match(staticSource, /minzoom: labelTier\.minZoom/);
  assert.match(staticSource, /filter: \["==", \["get", "labelTier"\], labelTier\.tier\]/);
  assert.match(staticSource, /"text-field": \["get", "NOMGEO"\]/);
  assert.match(staticSource, /"text-allow-overlap": false/);
  assert.match(staticSource, /"text-ignore-placement": false/);
  assert.match(staticSource, /"text-optional": true/);
  assert.match(staticSource, /"text-padding": 8/);
  assert.match(staticSource, /"symbol-sort-key": \["get", "labelPriority"\]/);
  assert.match(staticSource, /"text-color": "#ffffff"/);
  assert.match(staticSource, /"text-halo-color": "rgba\(74, 18, 40, 0\.92\)"/);
  assert.match(staticSource, /"text-halo-width": 1\.75/);
  assert.match(staticSource, /"text-halo-blur": 0\.35/);
  assert.doesNotMatch(staticSource, /"text-halo-width": 0/);
  assert.doesNotMatch(staticSource, /text-allow-overlap": true/);
  assert.match(orderSource, /REFERENCE_LABEL_LAYER_IDS\.forEach/);
  assert.match(orderSource, /ROAD_REFERENCE_BOUNDARY_LAYER_IDS\.forEach[\s\S]*REFERENCE_LABEL_LAYER_IDS\.forEach/);
  assert.match(mapSource, /const REFERENCE_LABEL_LAYER_IDS = \[\.\.\.LOCALITY_LABEL_LAYER_IDS, \.\.\.MUNICIPAL_LABEL_TIERS\.map\(\(tier\) => tier\.id\)\];/);
  assert.doesNotMatch(visibleSnapshotSource, /municipios-label-tier|MUNICIPAL_LABEL/);
  assert.doesNotMatch(popupSource, /municipios-label-tier|MUNICIPAL_LABEL/);
  assert.doesNotMatch(mapSource, /map\.on\("mouseenter", "municipios-label-tier|map\.on\("click", "municipios-label-tier"/);
  assert.doesNotMatch(mapSource, /map\.on\("zoom"[\s\S]*municipios-label-tier|map\.on\("move"[\s\S]*municipios-label-tier/);
  assert.doesNotMatch(staticSource, /"text-field": \["get", "NOMBRE"\]/);
});

test("las etiquetas municipales tienen umbrales explicitos crecientes sin duplicar features", () => {
  const tierConfigMatch = /const MUNICIPAL_LABEL_TIERS = Object\.freeze\(\(\[[\s\S]*?\]\)\);|const MUNICIPAL_LABEL_TIERS = Object\.freeze\(\[[\s\S]*?\]\);/.exec(mapSource);
  assert.ok(tierConfigMatch);
  const tiers = [...mapSource.matchAll(/\{ id: "municipios-label-tier-(\d)", tier: (\d), minZoom: ([0-9.]+) \}/g)]
    .map((match) => ({ idTier: Number(match[1]), tier: Number(match[2]), minZoom: Number(match[3]) }));
  assert.equal(tiers.length, 5);
  tiers.forEach((tier, index) => {
    assert.equal(tier.idTier, index + 1);
    assert.equal(tier.tier, index + 1);
    if (index > 0) {
      assert.ok(tier.minZoom > tiers[index - 1].minZoom);
    }
  });
  assert.ok(tiers[0].minZoom <= 8.6);
  assert.ok(tiers[4].minZoom <= 11.4);
  assert.equal(municipiosLabelPoints.features.length, 36);
  assert.equal(new Set(municipiosLabelPoints.features.map((featureItem) => featureItem.properties.CVEGEO)).size, 36);
  assert.equal(municipiosLabelPoints.features.filter((featureItem) => featureItem.properties.labelTier === 1).length, 6);
  assert.equal(municipiosLabelPoints.features.filter((featureItem) => featureItem.properties.labelTier === 5).length, 17);
});

test("las etiquetas de localidades se cargan diferidas y se preparan sin tocar el GeoJSON fuente", () => {
  const loadStaticSource = extractFunctionSource(mapSource, "loadStaticData");
  const initializeSource = extractFunctionSource(mapSource, "initializeLocalityLabels");
  const updateSource = extractFunctionSource(mapSource, "updateLocalityLabelsForZoom");
  const loadSource = extractFunctionSource(mapSource, "loadLocalityLabels");
  const prepareSource = extractFunctionSource(mapSource, "prepareLocalityLabelData");
  const setSource = extractFunctionSource(mapSource, "setLocalityLabelSourceData");

  assert.match(mapSource, /const LOCALITY_LABEL_SOURCE_ID = "localidades-labels-source";/);
  assert.match(mapSource, /const LOCALITY_LABEL_DATA_URL = "data\/base\/localidades_morelos\.geojson";/);
  assert.match(mapSource, /const LOCALITY_LABEL_PRELOAD_ZOOM = 9\.35;/);
  assert.match(mapSource, /const LOCALITY_LABEL_EMPTY_DATA = Object\.freeze\(\{ type: "FeatureCollection", features: \[\] \}\);/);
  assert.doesNotMatch(loadStaticSource, /localidades_morelos\.geojson/);

  assert.match(initializeSource, /upsertGeoJsonSource\(LOCALITY_LABEL_SOURCE_ID, sourceData\)/);
  assert.match(initializeSource, /bindLocalityLabelListeners\(\)/);
  assert.match(initializeSource, /scheduleLocalityLabelUpdate\(\)/);
  assert.match(updateSource, /map\.getZoom\(\) < LOCALITY_LABEL_PRELOAD_ZOOM/);
  assert.match(updateSource, /loadLocalityLabels\(\)/);
  assert.match(loadSource, /state\.localityLabels\.sourceData/);
  assert.match(loadSource, /state\.localityLabels\.loadPromise/);
  assert.match(loadSource, /fetch\(LOCALITY_LABEL_DATA_URL\)/);
  assert.match(loadSource, /state\.localityLabels\.metrics\.requestedFiles\.push\(LOCALITY_LABEL_DATA_URL\)/);
  assert.match(loadSource, /prepareLocalityLabelData\(collection\)/);

  assert.match(prepareSource, /const sortedFeatures = \[\.\.\.\(collection\?\.features \|\| \[\]\)\]\.sort/);
  assert.match(prepareSource, /const municipalityMetadata = new Map/);
  assert.match(prepareSource, /getMunicipalityKey\(properties\)/);
  assert.match(prepareSource, /normalizedLocality === municipality\.name/);
  assert.match(prepareSource, /seenMunicipalLocalityNames\.has\(repeatedKey\)/);
  assert.match(prepareSource, /__labelLevel: labelLevel/);
  assert.match(prepareSource, /__labelKind: properties\.esCabecera \? "cabecera" : "localidad"/);
  assert.match(prepareSource, /__effectiveMinZoom: effectiveMinZoom/);
  assert.match(prepareSource, /__labelSortKey: getLocalityLabelSortKey\(properties, labelLevel\)/);
  assert.match(prepareSource, /originalFeatures = collection\?\.features\?\.length \|\| 0/);
  assert.match(prepareSource, /deduplicatedFeatures = features\.length/);
  assert.match(mapSource, /sourceApplied: false/);
  assert.match(initializeSource, /state\.localityLabels\.sourceApplied = Boolean\(state\.localityLabels\.sourceData\)/);
  assert.match(setSource, /if \(state\.localityLabels\.sourceApplied && data === state\.localityLabels\.sourceData\) return/);
  assert.match(setSource, /state\.localityLabels\.sourceApplied = data === state\.localityLabels\.sourceData/);
});

test("las localidades usan cinco niveles progresivos sin popups marcadores ni controles", () => {
  const initializeSource = extractFunctionSource(mapSource, "initializeLocalityLabels");
  const orderSource = extractFunctionSource(mapSource, "ensureReferenceLayerOrder");
  const visibleSnapshotSource = extractFunctionSource(mapSource, "captureVisibleSnapshot");
  const popupSource = extractFunctionSource(mapSource, "bindMunicipiosPopup");

  assert.match(mapSource, /\{ id: "localidades-label-tier-1", level: 1, type: "cabecera", minZoom: 9\.55 \}/);
  assert.match(mapSource, /\{ id: "localidades-label-tier-2", level: 2, type: "cabecera", minZoom: 9\.8 \}/);
  assert.match(mapSource, /\{ id: "localidades-label-tier-3", level: 3, type: "localidad", minZoom: 10\.2 \}/);
  assert.match(mapSource, /\{ id: "localidades-label-tier-4", level: 4, type: "localidad", minZoom: 10\.7 \}/);
  assert.match(mapSource, /\{ id: "localidades-label-tier-5a", level: 5, type: "localidad", minZoom: 11\.1, minPopulation: 250 \}/);
  assert.match(mapSource, /\{ id: "localidades-label-tier-5b", level: 5, type: "localidad", minZoom: 12\.35, maxPopulation: 249 \}/);
  assert.match(initializeSource, /type: "symbol"/);
  assert.match(initializeSource, /source: LOCALITY_LABEL_SOURCE_ID/);
  assert.match(initializeSource, /filter: getLocalityLabelFilter\(labelTier\)/);
  assert.match(initializeSource, /"text-field": \["get", "NOM_LOC"\]/);
  assert.match(initializeSource, /"text-font": \["Open Sans Semibold"\]/);
  assert.doesNotMatch(initializeSource, /Open Sans Regular/);
  assert.match(initializeSource, /"text-size":[\s\S]*\["interpolate", \["linear"\], \["zoom"\], labelTier\.minZoom, 13\.5, 13\.4, 14\.5, 16, 15\]/);
  assert.match(initializeSource, /"text-size":[\s\S]*\["interpolate", \["linear"\], \["zoom"\], labelTier\.minZoom, 11\.5, 14\.5, 12\.7, 17, 13\.5\]/);
  assert.doesNotMatch(initializeSource, /"text-size": \["case"/);
  assert.match(initializeSource, /"text-allow-overlap": false/);
  assert.match(initializeSource, /"text-ignore-placement": false/);
  assert.match(initializeSource, /"text-optional": true/);
  assert.match(initializeSource, /"text-padding": labelTier\.level === 5 \? 1 : labelTier\.type === "cabecera" \? 7 : 6/);
  assert.match(initializeSource, /"symbol-sort-key": \["get", "__labelSortKey"\]/);
  assert.match(initializeSource, /"text-letter-spacing": labelTier\.type === "cabecera" \? 0\.02 : 0/);
  assert.match(initializeSource, /"text-variable-anchor": \["top", "bottom", "left", "right"\]/);
  assert.match(initializeSource, /"text-radial-offset": 0\.35/);
  assert.match(initializeSource, /paint: getLocalityLabelPaint\(\)/);
  assert.doesNotMatch(initializeSource, /type: "circle"|type: "fill"|type: "line"/);

  assert.match(mapSource, /const LOCALITY_LABEL_LAYER_IDS = LOCALITY_LABEL_TIERS\.map\(\(tier\) => tier\.id\);/);
  assert.match(mapSource, /const REFERENCE_LABEL_LAYER_IDS = \[\.\.\.LOCALITY_LABEL_LAYER_IDS, \.\.\.MUNICIPAL_LABEL_TIERS\.map\(\(tier\) => tier\.id\)\];/);
  assert.match(orderSource, /ROAD_REFERENCE_LAYER_IDS\.forEach[\s\S]*ROAD_REFERENCE_BOUNDARY_LAYER_IDS\.forEach[\s\S]*REFERENCE_LABEL_LAYER_IDS\.forEach/);
  assert.doesNotMatch(visibleSnapshotSource, /localidades-label|LOCALITY_LABEL/);
  assert.doesNotMatch(popupSource, /localidades-label|LOCALITY_LABEL/);
  assert.doesNotMatch(mapSource, /map\.on\("click", "localidades-label|map\.on\("mouseenter", "localidades-label|map\.on\("mouseleave", "localidades-label/);
  assert.doesNotMatch(mapSource, /localStorage\.setItem\([^)]*localidad|sessionStorage\.setItem\([^)]*localidad/i);
});

test("el nivel fino de localidades se divide por poblacion sin duplicar interacciones ni estilos", () => {
  const filterSource = extractFunctionSource(mapSource, "getLocalityLabelFilter");
  const initializeSource = extractFunctionSource(mapSource, "initializeLocalityLabels");

  assert.match(mapSource, /\{ id: "localidades-label-tier-5a", level: 5, type: "localidad", minZoom: 11\.1, minPopulation: 250 \}/);
  assert.match(mapSource, /\{ id: "localidades-label-tier-5b", level: 5, type: "localidad", minZoom: 12\.35, maxPopulation: 249 \}/);
  assert.match(filterSource, /const filters = \[\["==", \["get", "__effectiveMinZoom"\], labelTier\.minZoom\]\]/);
  assert.match(filterSource, /Number\.isFinite\(labelTier\.minPopulation\)/);
  assert.match(filterSource, /\[">=", \["to-number", \["get", "POBTOT"\]\], labelTier\.minPopulation\]/);
  assert.match(filterSource, /\["==", \["get", "__labelKind"\], "cabecera"\]/);
  assert.match(filterSource, /Number\.isFinite\(labelTier\.maxPopulation\)/);
  assert.match(filterSource, /\["<=", \["to-number", \["get", "POBTOT"\]\], labelTier\.maxPopulation\]/);
  assert.match(filterSource, /return filters\.length === 1 \? filters\[0\] : \["all", \.\.\.filters\]/);
  assert.match(initializeSource, /"text-padding": labelTier\.level === 5 \? 1 : labelTier\.type === "cabecera" \? 7 : 6/);
  assert.match(initializeSource, /labelTier\.level === 5[\s\S]*"text-variable-anchor": \["top", "bottom", "left", "right"\][\s\S]*"text-radial-offset": 0\.35/);
  assert.match(initializeSource, /"text-allow-overlap": false/);
  assert.match(initializeSource, /"text-ignore-placement": false/);
  assert.doesNotMatch(mapSource, /map\.on\("click", "localidades-label-tier-5a|map\.on\("click", "localidades-label-tier-5b/);
});

test("las reglas de escala de localidades conservan cabeceras y homonimos entre municipios", () => {
  const staticSource = extractFunctionSource(mapSource, "injectStaticSources");
  const levelSource = extractFunctionSource(mapSource, "getLocalityLabelLevel");
  const minZoomSource = extractFunctionSource(mapSource, "getLocalityEffectiveMinZoom");
  const nextZoomSource = extractFunctionSource(mapSource, "getNextLocalityLabelMinZoomAfter");
  const sortKeySource = extractFunctionSource(mapSource, "getLocalityLabelSortKey");
  const normalizeSource = extractFunctionSource(mapSource, "normalizeLabelName");
  const paintSource = extractFunctionSource(mapSource, "getLocalityLabelPaint");

  assert.match(levelSource, /properties\.esCabecera && population >= 25000\) \|\| population >= 50000\) return 1/);
  assert.match(levelSource, /if \(properties\.esCabecera \|\| population >= 25000\) return 2/);
  assert.match(levelSource, /if \(population >= 5000\) return 3/);
  assert.match(levelSource, /if \(population >= 1000\) return 4/);
  assert.match(levelSource, /return 5/);
  assert.match(mapSource, /const LOCALITY_LABEL_MIN_ZOOMS = Object\.freeze\(LOCALITY_LABEL_TIERS\.map\(\(tier\) => tier\.minZoom\)\);/);
  assert.match(minZoomSource, /if \(!properties\.esCabecera \|\| !Number\.isFinite\(municipality\?\.minZoom\)\) return baseMinZoom/);
  assert.match(minZoomSource, /Math\.max\(baseMinZoom, getNextLocalityLabelMinZoomAfter\(municipality\.minZoom\)\)/);
  assert.match(nextZoomSource, /LOCALITY_LABEL_MIN_ZOOMS\.find\(\(threshold\) => threshold > minZoom\)/);
  assert.match(sortKeySource, /labelLevel !== 5[\s\S]*labelLevel \* 100000 \+ Number\(properties\.labelPriority \|\| 99999\)/);
  assert.match(sortKeySource, /const population = Number\(properties\.POBTOT \|\| 0\)/);
  assert.match(sortKeySource, /const cabeceraRank = properties\.esCabecera \? 0 : 1/);
  assert.match(sortKeySource, /const populationRank = Math\.max\(0, 999999 - population\)/);
  assert.match(sortKeySource, /const priorityRank = Number\(properties\.labelPriority \|\| 99999\)/);
  assert.match(sortKeySource, /const cvegeoRank = Number\(String\(properties\.CVEGEO \|\| ""\)\.replace\(\/\\D\/g, ""\)\.slice\(-6\) \|\| 0\)/);
  assert.match(normalizeSource, /\.toLowerCase\(\)/);
  assert.match(normalizeSource, /\.normalize\("NFD"\)/);
  assert.match(normalizeSource, /\.replace\(\/\[\\u0300-\\u036f\]\/g, ""\)/);
  assert.match(normalizeSource, /[.,;:()[\\\]{}'"’`´_-]/);
  assert.match(normalizeSource, /\.replace\(\/\\s\+\/g, " "\)/);
  assert.match(paintSource, /state\.activeBaseMap === "oscuro"/);
  assert.match(paintSource, /state\.activeBaseMap === "satelite" \|\| state\.activeBaseMap === "topografico"/);
  assert.match(paintSource, /"text-color": \["case", \["==", \["get", "__labelKind"\], "cabecera"\], cabeceraColor, localidadColor\]/);
  assert.match(paintSource, /"text-halo-width": \["case", \["==", \["get", "__labelKind"\], "cabecera"\], 1\.7, 1\.35\]/);
  assert.doesNotMatch(paintSource, /rgba\(74, 18, 40, 0\.92\)|1\.75|0\.35/);
  assert.match(mapSource, /"text-size": \["interpolate", \["linear"\], \["zoom"\], labelTier\.minZoom, 12\.5, 12, 14, 14, 15\.5, 17, 17\]/);
  assert.doesNotMatch(staticSource, /"text-halo-width": 0/);
  assert.doesNotMatch(mapSource, /function getLocalityLabelTextSize/);
  assert.match(mapSource, /updateLocalityLabelPaint\(\);[\s\S]*ensureReferenceLayerOrder\(\);/);
});

test("cabeceras con nombre distinto nunca aparecen antes ni al mismo umbral que su municipio", () => {
  const municipalZoomByTier = new Map([[1, 8.6], [2, 9.3], [3, 9.8], [4, 10.7], [5, 11.4]]);
  const localityThresholds = [9.55, 9.8, 10.2, 10.7, 11.1, 12.35];
  const baseLocalityMinZoom = (properties) => {
    const population = Number(properties.POBTOT || 0);
    if ((properties.esCabecera && population >= 25000) || population >= 50000) return 9.55;
    if (population >= 25000) return 9.8;
    if (population >= 5000) return 10.2;
    if (population >= 1000) return 10.7;
    return population >= 250 ? 11.1 : 12.35;
  };
  const nextAfter = (minZoom) => localityThresholds.find((threshold) => threshold > minZoom) ?? localityThresholds.at(-1);
  const cabeceras = municipiosLabelPoints.features.map((municipalityFeature) => {
    const municipality = municipalityFeature.properties;
    const cabecera = localidadesMorelos.features.find((localityFeature) =>
      localityFeature.properties.CVE_ENT === municipality.CVE_ENT
      && localityFeature.properties.CVE_MUN === municipality.CVE_MUN
      && localityFeature.properties.esCabecera
    );
    assert.ok(cabecera, `Falta cabecera para ${municipality.NOMGEO}`);
    const municipalityMinZoom = municipalZoomByTier.get(Number(municipality.labelTier));
    const cabeceraMinZoom = baseLocalityMinZoom(cabecera.properties);
    const equivalent = normalizeTestLabelName(municipality.NOMGEO) === normalizeTestLabelName(cabecera.properties.NOM_LOC);
    return {
      municipality: municipality.NOMGEO,
      cabecera: cabecera.properties.NOM_LOC,
      equivalent,
      municipalityMinZoom,
      cabeceraMinZoom,
      effectiveMinZoom: equivalent ? null : Math.max(cabeceraMinZoom, nextAfter(municipalityMinZoom)),
    };
  });

  assert.equal(cabeceras.length, 36);
  assert.ok(cabeceras.filter((entry) => entry.equivalent).length > 0);
  assert.deepEqual(
    cabeceras.filter((entry) => !entry.equivalent && entry.cabeceraMinZoom <= entry.municipalityMinZoom).map((entry) => entry.municipality).sort(),
    ["Coatetelco", "Hueyapan", "Xoxocotla", "Zacatepec"],
  );
  for (const entry of cabeceras) {
    if (entry.equivalent) {
      assert.equal(entry.effectiveMinZoom, null, `${entry.municipality} conserva supresion por equivalencia`);
      continue;
    }
    assert.ok(
      entry.effectiveMinZoom > entry.municipalityMinZoom,
      `${entry.cabecera} debe aparecer despues de ${entry.municipality}`,
    );
  }
  assert.equal(cabeceras.find((entry) => entry.municipality === "Xoxocotla").effectiveMinZoom, 11.1);
  assert.equal(cabeceras.find((entry) => entry.municipality === "Coatetelco").effectiveMinZoom, 12.35);
  assert.equal(cabeceras.find((entry) => entry.municipality === "Ayala").effectiveMinZoom, 10.2);
  assert.equal(cabeceras.find((entry) => entry.municipality === "Yautepec").effectiveMinZoom, 9.55);
  assert.equal(cabeceras.find((entry) => entry.municipality === "Hueyapan").effectiveMinZoom, 12.35);
});

test("las vialidades de referencia se declaran en tres niveles con rangos de zoom progresivos", () => {
  assert.match(mapSource, /const ROAD_REFERENCE_LEVELS = Object\.freeze\(\{/);
  assert.match(mapSource, /1: \{[\s\S]*?url: "data\/base\/vialidades\/vialidades_nivel_1\.geojson"[\s\S]*?enterZoom: 0/);
  assert.match(mapSource, /2: \{[\s\S]*?url: "data\/base\/vialidades\/vialidades_nivel_2\.geojson"[\s\S]*?enterZoom: 12\.8/);
  assert.match(mapSource, /3: \{[\s\S]*?manifestUrl: "data\/base\/vialidades\/vialidades_nivel_3_manifest\.json"[\s\S]*?enterZoom: 15\.2/);
  assert.match(mapSource, /function getReferenceRoadLevelForZoom\(zoom\)/);
  assert.match(mapSource, /if \(zoom >= ROAD_REFERENCE_LEVELS\[3\]\.enterZoom\) return 3/);
  assert.match(mapSource, /if \(zoom >= ROAD_REFERENCE_LEVELS\[2\]\.enterZoom\) return 2/);
  assert.match(mapSource, /return 1/);
});

test("las vialidades usan fuentes vacias iniciales y Vial_3 queda diferido hasta zoom alto", () => {
  const loadStaticSource = extractFunctionSource(mapSource, "loadStaticData");
  const initializeSource = extractFunctionSource(mapSource, "initializeReferenceRoads");
  const updateSource = extractFunctionSource(mapSource, "updateReferenceRoadsForViewport");

  assert.doesNotMatch(loadStaticSource, /vialidades_nivel_3|vialidades_nivel_2/);
  assert.doesNotMatch(initializeSource, /isStyleLoaded\(\) return/);
  assert.match(initializeSource, /data: ROAD_REFERENCE_EMPTY_DATA/);
  assert.match(initializeSource, /bindReferenceRoadListeners\(\)/);
  assert.match(updateSource, /if \(requiredLevel === 3\)/);
  assert.match(updateSource, /loadVisibleRoadChunks\(\)/);
  assert.match(updateSource, /loadReferenceRoadLevel\(requiredLevel\)/);
  assert.match(mapSource, /const ROAD_REFERENCE_MAX_CACHED_CHUNKS = 32;/);
  assert.match(mapSource, /function pruneReferenceRoadChunkCache\(visibleChunkIds\)/);
  assert.match(mapSource, /chunkCache\.delete\(chunkId\)/);
  assert.match(mapSource, /state\.referenceRoads\.listenersBound/);
  assert.equal((mapSource.match(/map\.on\("zoomend", scheduleReferenceRoadUpdate\)/g) || []).length, 1);
  assert.equal((mapSource.match(/map\.on\("moveend", scheduleReferenceRoadUpdate\)/g) || []).length, 1);
});

test("el orden central mantiene vialidades encima de peligros y limites encima de vialidades", () => {
  const orderSource = extractFunctionSource(mapSource, "ensureReferenceLayerOrder");
  const addUserLayerSource = extractFunctionSource(mapSource, "addUserLayerToMap");
  const baseMapSource = extractFunctionSource(mapSource, "applyBaseMapVisibility");
  const restoreSource = extractFunctionSource(mapSource, "restoreMapState");

  assert.match(orderSource, /ROAD_REFERENCE_LAYER_IDS\.forEach/);
  assert.match(orderSource, /ROAD_REFERENCE_BOUNDARY_LAYER_IDS\.forEach/);
  assert.match(orderSource, /safeMoveLayer\(layerId\)/);
  assert.match(mapSource, /"municipios-hit"/);
  assert.match(mapSource, /"estado-highlight"/);
  assert.match(addUserLayerSource, /ensureReferenceLayerOrder\(\)/);
  assert.match(baseMapSource, /ensureReferenceLayerOrder\(\)/);
  assert.match(restoreSource, /initializeReferenceRoads\(\)/);
  assert.match(restoreSource, /ensureReferenceLayerOrder\(\)/);
});

test("las vialidades usan casing negro, centro blanco punteado y etiquetas oficiales", () => {
  const roadLayerSource = extractFunctionSource(mapSource, "addReferenceRoadLayers");
  const vial3CasingOpacity = ["interpolate", ["linear"], ["zoom"], 15.2, 0.48, 16, 0.38, 17, 0.27, 18, 0.16];
  const vial3CenterOpacity = ["interpolate", ["linear"], ["zoom"], 15.2, 0.82, 16, 0.74, 17, 0.62, 18, 0.48];
  const assertDecreasingOpacityStops = (expression) => {
    const stops = expression.slice(3);
    const opacities = stops.filter((_, index) => index % 2 === 1);
    opacities.forEach((opacity) => {
      assert.ok(opacity >= 0 && opacity <= 1, `opacidad fuera de rango: ${opacity}`);
    });
    for (let index = 1; index < opacities.length; index += 1) {
      assert.ok(opacities[index] < opacities[index - 1], "la opacidad de Vial_3 debe disminuir al aumentar zoom");
    }
  };

  assert.match(mapSource, /layerIds: \["vialidades-nivel-1-casing", "vialidades-nivel-1-center", "vialidades-nivel-1-label"\]/);
  assert.match(mapSource, /layerIds: \["vialidades-nivel-2-casing", "vialidades-nivel-2-center", "vialidades-nivel-2-label"\]/);
  assert.match(mapSource, /layerIds: \["vialidades-nivel-3-casing", "vialidades-nivel-3-center", "vialidades-nivel-3-label"\]/);

  assert.match(roadLayerSource, /1: \{ casing: 3\.6, center: 1\.45 \}/);
  assert.match(roadLayerSource, /2: \{ casing: 5, center: 1\.8 \}/);
  assert.match(roadLayerSource, /3: \{ casing: 7, center: 2\.4 \}/);
  assert.doesNotMatch(roadLayerSource, /"line-width": \["interpolate", \["linear"\], \["zoom"\]/);

  assert.match(roadLayerSource, /1: \{ casing: 0\.34, center: 0\.56 \}/);
  assert.match(roadLayerSource, /2: \{ casing: 0\.62, center: 0\.82 \}/);
  assert.match(roadLayerSource, /casing: \["interpolate", \["linear"\], \["zoom"\], 15\.2, 0\.48, 16, 0\.38, 17, 0\.27, 18, 0\.16\]/);
  assert.match(roadLayerSource, /center: \["interpolate", \["linear"\], \["zoom"\], 15\.2, 0\.82, 16, 0\.74, 17, 0\.62, 18, 0\.48\]/);
  assertDecreasingOpacityStops(vial3CasingOpacity);
  assertDecreasingOpacityStops(vial3CenterOpacity);

  assert.match(roadLayerSource, /1: \[2\.4, 1\.6\]/);
  assert.match(roadLayerSource, /2: \[2, 1\.6\]/);
  assert.match(roadLayerSource, /3: \[1\.4, 1\.5\]/);
  assert.match(roadLayerSource, /"line-color": "#000000"/);
  assert.match(roadLayerSource, /"line-color": "#ffffff"/);
  assert.match(roadLayerSource, /"line-dasharray": centerDashArrays\[level\]/);

  assert.match(roadLayerSource, /"line-cap": "round"/);
  assert.match(roadLayerSource, /"line-join": "round"/);
  assert.match(roadLayerSource, /"line-blur": 0/);
  assert.doesNotMatch(roadLayerSource, /line-gap-width/);
  assert.doesNotMatch(roadLayerSource, /#7a203a/i);
  assert.doesNotMatch(roadLayerSource, /#2563eb|#3b82f6|#60a5fa/i);

  assert.match(roadLayerSource, /type: "symbol"/);
  assert.match(roadLayerSource, /"symbol-placement": "line"/);
  assert.match(roadLayerSource, /"text-field": \[\s*"case"[\s\S]*?\["get", "nombre_mostrar"\][\s\S]*?\["get", "nombre"\][\s\S]*?""/);
  assert.match(roadLayerSource, /"text-keep-upright": true/);
  assert.match(roadLayerSource, /"text-rotation-alignment": "map"/);
  assert.match(roadLayerSource, /"text-allow-overlap": false/);
  assert.match(roadLayerSource, /\["has", "nombre_mostrar"\]/);
  assert.match(roadLayerSource, /\["!=", \["downcase", \["get", "nombre_mostrar"\]\], "sin nombre"\]/);
  assert.match(roadLayerSource, /\["!=", \["downcase", \["get", "nombre_mostrar"\]\], "s\/n"\]/);
  assert.match(roadLayerSource, /\["!=", \["downcase", \["get", "nombre"\]\], "sin nombre"\]/);
  assert.match(roadLayerSource, /\["!=", \["downcase", \["get", "nombre"\]\], "s\/n"\]/);

  assert.match(mapSource, /const INSTITUTIONAL_BOUNDARY_COLOR = "#7a203a";/);
  assert.match(mapSource, /const MUNICIPAL_BOUNDARY_COLOR = "#9ca3af";/);
  assert.match(mapSource, /const STATE_BOUNDARY_BASE_WIDTH = \["interpolate", \["linear"\], \["zoom"\], 6, 2\.8, 10, 3\.8, 14, 5\.2\]/);
  assert.match(mapSource, /const MUNICIPAL_BOUNDARY_WIDTH = \["interpolate", \["linear"\], \["zoom"\], 6, 0\.55, 10, 0\.8, 14, 1\.1\]/);
  assert.match(mapSource, /const ROAD_REFERENCE_DISPLAY_NAMES_URL = "data\/base\/vialidades\/nombres_viales_mostrar\.json"/);
  assert.match(mapSource, /function applyReferenceRoadDisplayNames\(level, collection\)/);
  assert.match(mapSource, /properties\.nombre_mostrar = displayName/);
});

test("los derivados de vialidades estan separados, en WGS84 y conservan atributos utiles", () => {
  assert.equal(vialidadesNivel1.metadata.crs, "EPSG:4326");
  assert.equal(vialidadesNivel2.metadata.crs, "EPSG:4326");
  assert.equal(vialidadesNivel3Manifest.crs, "EPSG:4326");
  assert.equal(vialidadesNivel1.features.length, 30);
  assert.equal(vialidadesNivel2.features.length, 5454);
  assert.equal(vialidadesNivel3Manifest.sourceFeatureCount, 78892);
  assert.equal(vialidadesNivel3Manifest.renderFeatureCount, 78891);
  assert.equal(vialidadesNivel3Manifest.omittedFeatures.length, 1);
  assert.equal(vialidadesNivel3Manifest.grid.columns, 16);
  assert.equal(vialidadesNivel3Manifest.grid.rows, 16);
  assert.ok(vialidadesNivel3Manifest.chunks.length > 100);
  assert.ok(vialidadesNivel3Manifest.chunks.every((chunk) => chunk.url.includes("data/base/vialidades/vialidades_nivel_3/chunk_")));

  const nivel1Props = vialidadesNivel1.features[0].properties;
  const nivel2Props = vialidadesNivel2.features[0].properties;
  assert.deepEqual(Object.keys(nivel1Props), ["id", "nivel_vial", "nombre", "administra", "longitud_km"]);
  ["id", "nivel_vial", "tipo_vial", "nombre", "condicion_pavimento", "recubrimiento", "administra", "jurisdiccion"].forEach((field) => {
    assert.ok(Object.hasOwn(nivel2Props, field), `Falta ${field}`);
  });
});

test("la auditoria de nombres viales cubre todos los niveles y conserva trazabilidad", async () => {
  const usefulName = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    return Boolean(normalized) && normalized !== "sin nombre" && normalized !== "s/n";
  };
  const level3Collections = await Promise.all(
    vialidadesNivel3Manifest.chunks.map(async (chunk) => JSON.parse(await fs.readFile(path.resolve(chunk.url), "utf8")))
  );
  const level3Features = level3Collections.flatMap((collection) => collection.features || []);
  const level1Named = vialidadesNivel1.features.filter((featureItem) => usefulName(featureItem.properties?.nombre));
  const level2Named = vialidadesNivel2.features.filter((featureItem) => usefulName(featureItem.properties?.nombre));
  const level3Named = level3Features.filter((featureItem) => usefulName(featureItem.properties?.nombre));

  assert.equal(vialidadesNameDiagnostic.totals.featureInstances, 86631);
  assert.equal(vialidadesNameDiagnostic.totals.uniqueFeatures, 84375);
  assert.equal(vialidadesNameDiagnostic.levels["1"].featureInstances, 30);
  assert.equal(vialidadesNameDiagnostic.levels["2"].featureInstances, 5454);
  assert.equal(vialidadesNameDiagnostic.levels["3"].featureInstances, 81147);
  assert.equal(vialidadesNameDiagnostic.levels["3"].uniqueFeatures, 78891);
  assert.equal(vialidadesNameDiagnostic.vial3Manifest.renderFeatureCount, 78891);
  assert.equal(vialidadesNameDiagnostic.vial3Manifest.featureInstancesInChunks, level3Features.length);
  assert.equal(vialidadesNameDiagnostic.vial3Manifest.namedInstancePercent, 78.93);
  assert.equal(vialidadesNameCorrections.correctionCount, 17206);
  assert.equal(vialidadesDisplayNames.correctionCount, 17206);
  assert.equal(vialidadesDisplayNames.names["1:118"], "México - Cuernavaca");

  assert.equal(level1Named.length, vialidadesNivel1.features.length);
  assert.equal(level2Named.length, vialidadesNivel2.features.length);
  assert.equal(level3Named.length, 64052);
  assert.ok(vialidadesNivel1.features.every((featureItem) => Object.hasOwn(featureItem.properties, "id")));
  assert.ok(vialidadesNivel2.features.every((featureItem) => Object.hasOwn(featureItem.properties, "id")));
  assert.ok(level3Features.every((featureItem) => Object.hasOwn(featureItem.properties, "id")));

  const correctedLevel1 = vialidadesNivel1.features.find((featureItem) => featureItem.properties.id === 118);
  assert.equal(correctedLevel1.properties.nombre, "MÃ©xico - Cuernavaca");
  assert.equal(Object.hasOwn(correctedLevel1.properties, "nombre_mostrar"), false);
  assert.equal(Object.hasOwn(correctedLevel1.properties, "nombre_fuente"), false);
  assert.equal(Object.hasOwn(correctedLevel1.properties, "nombre_confianza"), false);
  const correctedLevel1Trace = vialidadesNameCorrections.corrections.find((item) => item.level === 1 && item.id === 118);
  assert.equal(correctedLevel1Trace.source, "normalizacion-segura");
  assert.equal(correctedLevel1Trace.confidence, "alta");

  const ambiguousNumeric = vialidadesNameDiagnostic.ambiguousCases.find((item) => item.problems.includes("solo_numero_o_clave"));
  assert.ok(ambiguousNumeric);
  assert.equal(vialidadesDisplayNames.names[`${ambiguousNumeric.level}:${ambiguousNumeric.id}`], undefined);

  const correctedValues = [
    ...Object.values(vialidadesDisplayNames.names),
  ];
  correctedValues.forEach((value) => {
    assert.doesNotMatch(value, /[\u0000-\u001f\u007f]/);
    assert.doesNotMatch(value, /<[a-z][\s\S]*>/i);
    assert.doesNotMatch(value, /Ã.|Â.|â[€\u0080-\u009f]?|�/);
  });
  assert.doesNotMatch(mapSource, /map\.on\("click", "vialidades-nivel|map\.on\("mouseenter", "vialidades-nivel/);
});

test("el auditor de nombres viales es determinista al ejecutarse dos veces", async () => {
  const files = [
    path.resolve("data/base/vialidades/vialidades_nivel_1.geojson"),
    path.resolve("data/base/vialidades/vialidades_nivel_2.geojson"),
    path.resolve("data/base/vialidades/diagnostico_nombres_viales.json"),
    path.resolve("data/base/vialidades/correcciones_nombres_viales.json"),
    path.resolve("data/base/vialidades/nombres_viales_mostrar.json"),
    ...vialidadesNivel3Manifest.chunks.map((chunk) => path.resolve(chunk.url)),
  ];
  const hashFiles = async () => {
    const entries = await Promise.all(files.map(async (filePath) => {
      const buffer = await fs.readFile(filePath);
      return [path.relative(process.cwd(), filePath), crypto.createHash("sha256").update(buffer).digest("hex")];
    }));
    return Object.fromEntries(entries);
  };

  const before = await hashFiles();
  const { stdout } = await execFileAsync(process.execPath, ["scripts/audit-vialidades-nombres.mjs"], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 5,
  });
  const after = await hashFiles();

  assert.deepEqual(after, before);
  assert.match(stdout, /"correctionCount": 17206/);
  assert.match(stdout, /"filesChanged": 0/);
});

test("los derivados de vialidades no usan coordenadas UTM ni geometria vacia", () => {
  [vialidadesNivel1, vialidadesNivel2].forEach((collection) => {
    collection.features.forEach((featureItem) => {
      assert.ok(featureItem.geometry);
      walkCoordinatePairs(featureItem.geometry.coordinates, ([lon, lat]) => {
        assert.ok(lon >= -180 && lon <= 180);
        assert.ok(lat >= -90 && lat <= 90);
      });
    });
  });
  vialidadesNivel3Manifest.chunks.forEach((chunk) => {
    assert.equal(chunk.bbox.length, 4);
    assert.ok(chunk.bbox[0] >= -180 && chunk.bbox[2] <= 180);
    assert.ok(chunk.bbox[1] >= -90 && chunk.bbox[3] <= 90);
    assert.ok(chunk.features > 0);
    assert.ok(chunk.bytes > 0);
  });
});

test("el manifest de vialidades detalladas referencia solo chunks validos y acotados", async () => {
  const baseDir = path.resolve("data/base/vialidades");
  const chunkDir = path.resolve(baseDir, "vialidades_nivel_3");
  const forbiddenPathPattern = /([A-Za-z]:\\|\\\\|localhost|127\.0\.0\.1)/i;
  const forbiddenUrlPattern = /([A-Za-z]:\\|\\\\|localhost|127\.0\.0\.1|api[_-]?key|token|password|secret)/i;

  assert.equal(vialidadesNivel3Manifest.chunks.length, 191);
  assert.equal(vialidadesNivel3Manifest.omittedFeatures.length, 1);
  assert.match(vialidadesNivel3Manifest.omittedFeatures[0].reason, /zero-length|geometr/i);

  const seenChunkIds = new Set();
  for (const chunk of vialidadesNivel3Manifest.chunks) {
    assert.equal(seenChunkIds.has(chunk.id), false, chunk.id);
    seenChunkIds.add(chunk.id);
    assert.doesNotMatch(chunk.url, forbiddenUrlPattern);
    assert.match(chunk.url, /^data\/base\/vialidades\/vialidades_nivel_3\/chunk_\d+_\d+\.geojson$/);

    const chunkPath = path.resolve(chunk.url);
    assert.ok(chunkPath.startsWith(chunkDir));
    const stat = await fs.stat(chunkPath);
    assert.equal(stat.size, chunk.bytes);
    assert.ok(stat.size <= 4_000_000, `${chunk.url} excede el limite esperado`);

    const text = await fs.readFile(chunkPath, "utf8");
    assert.doesNotMatch(text, forbiddenPathPattern);
    const collection = JSON.parse(text);
    assert.equal(collection.type, "FeatureCollection");
    assert.ok(Array.isArray(collection.features));
    assert.ok(collection.features.length > 0);
    collection.features.forEach((featureItem) => {
      assert.ok(featureItem.geometry);
      walkCoordinatePairs(featureItem.geometry.coordinates, ([lon, lat]) => {
        assert.ok(lon >= -180 && lon <= 180);
        assert.ok(lat >= -90 && lat <= 90);
      });
    });
  }

  const allowedFiles = new Set([
    path.resolve(baseDir, "README.md"),
    path.resolve(baseDir, "diagnostico_generacion.json"),
    path.resolve(baseDir, "diagnostico_nombres_viales.json"),
    path.resolve(baseDir, "correcciones_nombres_viales.json"),
    path.resolve(baseDir, "nombres_viales_mostrar.json"),
    path.resolve(baseDir, "vialidades_nivel_1.geojson"),
    path.resolve(baseDir, "vialidades_nivel_2.geojson"),
    path.resolve(baseDir, "vialidades_nivel_3_manifest.json"),
    ...vialidadesNivel3Manifest.chunks.map((chunk) => path.resolve(chunk.url)),
  ]);
  const diskEntries = await fs.readdir(baseDir, { recursive: true, withFileTypes: true });
  const diskFiles = diskEntries
    .filter((entry) => entry.isFile())
    .map((entry) => path.resolve(entry.parentPath || baseDir, entry.name));
  assert.deepEqual(new Set(diskFiles), allowedFiles);
});

test("la seleccion de capa queda separada de la leyenda flotante automatica", () => {
  const renderCatalogSource = extractFunctionSource(mapSource, "renderLayerCatalog");
  const renderItemSource = extractFunctionSource(mapSource, "renderLayerItem");
  assert.match(mapSource, /function selectLayer\(layerId, options = \{\}\)/);
  assert.match(renderCatalogSource, /event\.target\.closest\("button, input, label, a"\)/);
  assert.match(mapSource, /data-select-layer/);
  assert.match(mapSource, /aria-pressed/);
  assert.doesNotMatch(renderItemSource, /data-toggle-legend/);
  assert.doesNotMatch(renderItemSource, /aria-controls="map-legend-float"/);
  assert.doesNotMatch(renderItemSource, /layer-legend-button/);
  assert.doesNotMatch(mapSource, /function toggleFloatingLegend/);
  assert.doesNotMatch(mapSource, /activeLegendTrigger/);
  assert.match(mapSource, /function openFloatingLegendForLayer\(layerId, options = \{\}\)/);
  assert.match(mapSource, /function renderFloatingLegend/);
  assert.doesNotMatch(mapSource, /renderSelectedLayerLegend/);
  assert.doesNotMatch(mapSource, /revealSelectedLayerLegend/);
  assert.match(mapSource, /state\.symbologyCache/);
  assert.match(mapSource, /Simbolo de la capa/);
  assert.match(mapSource, /function getLegendSwatchStyle/);
  assert.doesNotMatch(mapSource, /title: current\.title,\s*description: visible \?/);
  assert.match(mapSource, /getPropertyValueByAlias\(properties, \["description", "Description"\]\)/);
});

test("las tarjetas publicas omiten metadatos descriptivos y conservan controles", () => {
  const renderItemSource = extractFunctionSource(mapSource, "renderLayerItem");
  const renderCatalogSource = extractFunctionSource(mapSource, "renderLayerCatalog");

  assert.match(renderItemSource, /type="checkbox"/);
  assert.match(renderItemSource, /data-select-layer/);
  assert.doesNotMatch(renderItemSource, /data-toggle-legend/);
  assert.doesNotMatch(renderItemSource, /title="Mostrar simbologia"/);
  assert.doesNotMatch(renderItemSource, /aria-expanded/);
  assert.doesNotMatch(cssSource, /\.layer-legend-button/);
  assert.match(renderItemSource, /Visibilidad <strong>\$\{opacityValue\}%<\/strong>/);
  assert.match(renderItemSource, /type="range" min="10" max="100" step="5"/);
  assert.match(renderItemSource, /data-opacity/);

  assert.doesNotMatch(renderItemSource, /layer\.description/);
  assert.doesNotMatch(renderItemSource, /layer\.group/);
  assert.doesNotMatch(renderItemSource, /layer\.municipality/);
  assert.doesNotMatch(renderItemSource, /layer\.fileType/);
  assert.doesNotMatch(renderItemSource, /renderBadges\(layer\)/);
  assert.doesNotMatch(renderItemSource, /Cobertura estatal/);
  assert.doesNotMatch(renderItemSource, /&middot;| · /);
  assert.doesNotMatch(renderItemSource, /<div class="layer-badges">/);

  assert.match(renderItemSource, /\$\{actionButtons \? `<div class="layer-actions">/);
  assert.doesNotMatch(renderItemSource, /<div class="layer-actions">\s*<\/div>/);
  assert.match(renderCatalogSource, /querySelectorAll\("\[data-opacity\]"\)/);
  assert.match(renderCatalogSource, /label\.textContent = `\$\{Math\.round\(Number\(event\.target\.value\)\)\}%`/);
  assert.match(renderCatalogSource, /updateLayerOpacity\(event\.target\.dataset\.opacity, Number\(event\.target\.value\), \{ persist: false \}\)/);
  assert.match(renderCatalogSource, /updateLayerOpacity\(event\.target\.dataset\.opacity, Number\(event\.target\.value\), \{ persist: true \}\)/);
});

test("las descripciones permanecen para datos internos pero no se insertan en la tarjeta publica", () => {
  const renderItemSource = extractFunctionSource(mapSource, "renderLayerItem");
  const resolveCategorySource = extractFunctionSource(mapSource, "resolveLayerCategory");

  ["Contorno general del estado de Morelos", "División municipal para consulta operativa"].forEach((description) => {
    assert.match(mapSource, new RegExp(description));
    assert.doesNotMatch(renderItemSource, new RegExp(description));
  });

  assert.match(resolveCategorySource, /layer\.description/);
  assert.match(mapSource, /description:/);
  assert.doesNotMatch(renderItemSource, /descripcion|description|categoria|category|cobertura|formato|origen|source|Referencia|Visualizable/i);
});

test("el espaciado de tarjetas queda compacto sin contenedores eliminados", () => {
  const itemRule = cssSource.match(/\.layer-item\s*\{(?<body>[\s\S]*?)\n\}/u);
  const copyRule = cssSource.match(/\.layer-item__copy\s*\{(?<body>[\s\S]*?)\n\}/u);
  const opacityRule = cssSource.match(/\.layer-opacity-control\s*\{(?<body>[\s\S]*?)\n\}/u);

  assert.ok(itemRule?.groups?.body);
  assert.ok(copyRule?.groups?.body);
  assert.ok(opacityRule?.groups?.body);
  assert.match(itemRule.groups.body, /padding:\s*10px 12px/);
  assert.match(copyRule.groups.body, /gap:\s*7px/);
  assert.match(opacityRule.groups.body, /margin-top:\s*0/);
  assert.match(cssSource, /\.layer-opacity-control input\[type="range"\]\s*\{[\s\S]*?width:\s*100%/);
  assert.match(cssSource, /\.layer-select-button\s*\{[\s\S]*?max-width:\s*100%/);
  assert.match(cssSource, /\.layer-select-button\s*\{[\s\S]*?text-align:\s*left/);
});

test("diagnostica backend desconectado, vacio, valido e invalido con mensajes publicos", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  const layersApiSource = await fs.readFile(path.resolve("js/app/services/layers-api.js"), "utf8");
  assert.match(html, /id="layer-catalog-notice"/);
  assert.match(mapSource, /function classifyBackendSyncError/);
  assert.match(mapSource, /state: "unavailable"/);
  assert.match(mapSource, /"ready" : "empty"/);
  assert.match(mapSource, /state\.backendStatus\.state = hydratedLayers\.length \? "ready" : "empty"/);
  assert.match(mapSource, /state: "http-error"/);
  assert.match(mapSource, /state: "invalid"/);
  assert.match(mapSource, /Las capas temáticas no están disponibles temporalmente/);
  assert.match(mapSource, /Por el momento no hay capas temáticas publicadas/);
  assert.doesNotMatch(mapSource, /extra: \[runtimeConfig\.apiBaseUrl/);
  assert.match(layersApiSource, /INVALID_LAYER_RESPONSE/);
});

test("las capas locales siguen presentes aunque fallen las remotas", () => {
  assert.match(mapSource, /const staticLayers = \[/);
  assert.match(mapSource, /id: "estado"/);
  assert.match(mapSource, /id: "municipios"/);
  assert.match(mapSource, /const localLayers = state\.userLayers\.filter\(\(layer\) => !layer\.backendLayerId\)/);
  assert.match(mapSource, /state\.userLayers = \[\.\.\.localLayers, \.\.\.remoteLayers\]/);
});

test("el frontend reconstruye GroundOverlay raster y capas mixtas sin tratarlas como vector puro", async () => {
  const layersApiSource = await fs.readFile(path.resolve("js/app/services/layers-api.js"), "utf8");
  const backendServiceSource = await fs.readFile(path.resolve("backend/src/modules/layers/layers.service.js"), "utf8");
  const processingSource = await fs.readFile(path.resolve("backend/src/modules/layers/layer-processing.service.js"), "utf8");

  assert.match(mapSource, /analyzeGeospatialFile/);
  assert.match(mapSource, /createGroundOverlayObjectUrls/);
  assert.match(mapSource, /sourceKind:\s*record\.resourceType === "mixed" \? "mixed" : "ground-overlay"/);
  assert.match(mapSource, /function createGroundOverlayLayerFromBackend/);
  assert.match(mapSource, /record\.groundOverlays/);
  assert.match(mapSource, /type:\s*"image"/);
  assert.match(mapSource, /"raster-opacity"/);
  assert.match(mapSource, /function revokeLayerObjectUrls/);
  assert.match(mapSource, /buildRasterLegendFallback/);
  assert.match(layersApiSource, /formData\.append\("rasterLegend", metadata\.rasterLegend \? JSON\.stringify\(metadata\.rasterLegend\) : ""\)/);
  assert.match(mapSource, /detectRasterLegendColors/);
  assert.match(mapSource, /preloadRasterLegendColorsFromPreview/);
  assert.match(mapSource, /extractRasterLegendColors/);
  assert.match(backendServiceSource, /resourceType:\s*metadataProperties\.resourceType/);
  assert.match(backendServiceSource, /groundOverlays:\s*metadataProperties\.groundOverlays/);
  assert.match(backendServiceSource, /rasterLegend:\s*metadataProperties\.rasterLegend/);
  assert.match(processingSource, /resourceType:\s*"ground-overlay"/);
  assert.match(processingSource, /resourceType:\s*"mixed"/);
  assert.match(processingSource, /extractGroundOverlayImages/);
  assert.match(processingSource, /detectRasterLegendForGroundOverlays/);
  assert.match(processingSource, /rasterLegend:\s*rasterLegendDetection\.rasterLegend/);
  assert.match(processingSource, /rasterLegendDiagnostics:\s*rasterLegendDetection\.diagnostics/);
});

test("la carga de capas usa timeout extendido y revisa duplicados tras cancelacion", async () => {
  const layersApiSource = await fs.readFile(path.resolve("js/app/services/layers-api.js"), "utf8");
  const httpClientSource = await fs.readFile(path.resolve("js/app/services/http-client.js"), "utf8");

  assert.match(layersApiSource, /LAYER_UPLOAD_TIMEOUT_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
  assert.match(layersApiSource, /timeoutMs:\s*LAYER_UPLOAD_TIMEOUT_MS/);
  assert.match(httpClientSource, /TimeoutError/);
  assert.match(mapSource, /Procesando capa; esta operación puede tardar varios minutos/);
  assert.match(mapSource, /findRecentlySavedUploadDraftLayer/);
  assert.match(mapSource, /Revisa el catálogo administrativo antes de reintentar/);
});

test("la reconstruccion backend no conserva estilos colapsados cuando existe campo tematico seguro", () => {
  assert.match(mapSource, /function hasUsefulExistingStyle/);
  assert.match(mapSource, /Estilo persistido colapsado; se usará campo temático como respaldo/);
  assert.match(mapSource, /preserveExistingStyle/);
  assert.match(mapSource, /getLayerStyleOpacityPaintValue/);
  assert.match(mapSource, /"__styleOpacity"/);
  assert.match(mapSource, /"muy baja": "#006100"/);
  assert.match(mapSource, /baja: "#7aab00"/);
  assert.match(mapSource, /media: "#ffff00"/);
  assert.match(mapSource, /alta: "#ff9900"/);
  assert.match(mapSource, /"muy alta": "#ff2200"/);
});

test("visibilidad y opacidad de capas grandes no reconstruyen fuentes innecesariamente", () => {
  const toggleSource = extractFunctionSource(mapSource, "toggleLayerVisibility");
  const schedulerSource = extractFunctionSource(mapSource, "scheduleLayerOpacityUpdate");
  const saveSource = extractFunctionSource(mapSource, "saveUserLayers");
  const renderCatalogSource = extractFunctionSource(mapSource, "renderLayerCatalog");

  assert.match(toggleSource, /setUserLayerLayoutVisibility\(userLayer, false\)/);
  assert.doesNotMatch(toggleSource, /removeLayerBundle\(userLayer\.id\)/);
  assert.match(toggleSource, /!state\.renderedLayers\.has\(userLayer\.id\)/);
  assert.match(mapSource, /function updateLayerOpacity\(layerId, percentage, options = \{\}\)/);
  assert.match(mapSource, /scheduleLayerOpacityUpdate\(layerId, \(\) => applyUserLayerOpacityToMap\(userLayer\)\)/);
  assert.match(mapSource, /if \(options\.persist !== false\)/);
  assert.match(schedulerSource, /requestAnimationFrame/);
  assert.match(schedulerSource, /cancelAnimationFrame/);
  assert.match(mapSource, /function paintValuesMatch/);
  assert.match(mapSource, /map\.getPaintProperty\(layerId, property\)/);
  assert.match(mapSource, /map\.getLayoutProperty\(layerId, property\)/);
  assert.match(mapSource, /type: "scalar"/);
  assert.match(saveSource, /visible:\s*Boolean\(layer\.visible\)/);
  assert.match(renderCatalogSource, /updateLayerOpacity\(event\.target\.dataset\.opacity, Number\(event\.target\.value\), \{ persist: false \}\)/);
  assert.match(renderCatalogSource, /input\.addEventListener\("change"/);
});

test("el visitante recibe catalogo compacto sin slider ni acciones administrativas", () => {
  const renderItemSource = extractFunctionSource(mapSource, "renderLayerItem");
  const visitorItemSource = extractFunctionSource(mapSource, "renderVisitorLayerItem");
  const groupSource = extractFunctionSource(mapSource, "renderLayerGroup");
  const renderSessionSource = extractFunctionSource(mapSource, "renderSession");

  assert.match(mapSource, /function isPublicVisitor\(\) \{/);
  assert.match(renderSessionSource, /app-shell--visitor/);
  assert.match(renderSessionSource, /app-shell--admin/);
  assert.match(renderItemSource, /if \(isPublicVisitor\(\)\) return renderVisitorLayerItem\(layer\)/);
  assert.match(groupSource, /layer-group__toggle-sign/);
  assert.match(groupSource, /\[\$\{layers\.length\}\]/);
  assert.match(visitorItemSource, /layer-item--visitor/);
  assert.match(visitorItemSource, /class="layer-visibility-label"/);
  assert.match(visitorItemSource, /class="layer-visibility-checkbox" type="checkbox"/);
  assert.match(visitorItemSource, /class="layer-name--visitor"/);
  assert.match(visitorItemSource, /title="\$\{escapeHtml\(layer\.title\)\}"/);
  assert.doesNotMatch(visitorItemSource, /data-transparency-fixed/);
  assert.doesNotMatch(visitorItemSource, /Transparencia 20%/);
  assert.doesNotMatch(visitorItemSource, /role="switch"/);
  assert.doesNotMatch(visitorItemSource, /data-opacity/);
  assert.doesNotMatch(visitorItemSource, /data-publish/);
  assert.doesNotMatch(visitorItemSource, /data-delete/);
  assert.match(mapSource, /function syncVisitorLayerPanelLabels\(\)/);
  assert.match(mapSource, /placeholder = visitor \? "Buscar capa"/);
  assert.match(mapSource, /setAttribute\("aria-label", "Buscar capa"\)/);
  assert.match(cssSource, /\.app-shell--visitor \.layer-group/);
  assert.match(cssSource, /\.app-shell--visitor \.layer-item--visitor/);
  assert.match(cssSource, /\.app-shell--visitor #layers-panel > \.panel-summary \{[\s\S]*display: none;/);
  assert.match(cssSource, /\.app-shell--visitor #layers-panel \.search-box span \{[\s\S]*display: none;/);
  assert.match(cssSource, /\.app-shell--visitor \.layer-group__toggle-sign::before \{[\s\S]*content: "\+"/);
  assert.match(cssSource, /\.app-shell--visitor \.layer-group\[open\] > \.layer-group__summary \.layer-group__toggle-sign::before \{[\s\S]*content: "-"/);
  assert.match(cssSource, /\.app-shell--visitor \.layer-visibility-checkbox/);
  assert.match(cssSource, /\.app-shell--visitor \.layer-name--visitor \{[\s\S]*white-space: nowrap;[\s\S]*text-overflow: ellipsis;/);
  assert.doesNotMatch(cssSource, /layer-transparency-toggle/);
  assert.match(cssSource, /\.app-shell--visitor \.layer-item--visitor \{[\s\S]*border-radius: 0;[\s\S]*box-shadow: none;/);
  assert.match(cssSource, /\.app-shell--visitor \.layer-group \{[\s\S]*border-radius: 0;[\s\S]*box-shadow: none;/);
});

test("el administrador conserva slider continuo y botones de gestion", () => {
  const renderItemSource = extractFunctionSource(mapSource, "renderLayerItem");

  assert.match(renderItemSource, /state\.session\.role === "admin" && canPreviewLayer\(layer\)/);
  assert.match(renderItemSource, /data-publish="\$\{layer\.id\}"/);
  assert.match(renderItemSource, /data-delete="\$\{layer\.id\}"/);
  assert.match(renderItemSource, /class="layer-opacity-control"/);
  assert.match(renderItemSource, /input type="range" min="10" max="100" step="5"/);
});

test("visitante omite bloque de informacion lateral y administrador lo conserva", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  const renderSessionSource = extractFunctionSource(mapSource, "renderSession");
  const updateInfoSource = extractFunctionSource(mapSource, "updateInfoPanel");

  assert.match(html, /id="info-panel-section"/);
  assert.match(html, /id="info-panel"/);
  assert.match(html, /Detalle de la selecci/);
  assert.match(mapSource, /infoPanelSection: document\.getElementById\("info-panel-section"\)/);
  assert.match(renderSessionSource, /const visitorMode = isPublicVisitor\(\)/);
  assert.match(renderSessionSource, /infoPanelSection\?\.toggleAttribute\("hidden", visitorMode\)/);
  assert.match(renderSessionSource, /data-panel-target="info-panel-section"/);
  assert.match(cssSource, /\.app-shell--visitor #info-panel-section,[\s\S]*\.app-shell--visitor \[data-panel-target="info-panel-section"\],[\s\S]*\.is-visitor-hidden \{[\s\S]*display: none;/);
  assert.match(mapSource, /function openInfoPopup\(\{ ownerLayerId, resourceType, mapLayerId, overlayId = null, coordinate, html, info \}\) \{[\s\S]*updateInfoPanel\(info\);[\s\S]*new maplibregl\.Popup/);
  assert.match(updateInfoSource, /elements\.infoPanel\.innerHTML/);
});

test("visitante no conserva transparencia fija y activa capas al 100 por ciento", () => {
  const toggleVisibilitySource = extractFunctionSource(mapSource, "toggleLayerVisibility");
  const saveSource = extractFunctionSource(mapSource, "saveUserLayers");

  assert.doesNotMatch(mapSource, /toggleVisitorLayerTransparency/);
  assert.doesNotMatch(mapSource, /data-transparency-fixed/);
  assert.doesNotMatch(mapSource, /__visitorTransparency/);
  assert.doesNotMatch(mapSource, /__visitorOpacityBeforeTransparency/);
  assert.doesNotMatch(mapSource, /updateLayerOpacity\(layerId, 80/);
  assert.doesNotMatch(cssSource, /20%/);
  assert.doesNotMatch(cssSource, /layer-transparency-toggle/);
  assert.match(toggleVisibilitySource, /if \(visible && isPublicVisitor\(\)\) \{[\s\S]*updateLayerOpacity\(layerId, 100, \{ persist: false \}\)/);
  assert.match(saveSource, /opacity:\s*clampLayerOpacity\(layer\.opacity \?\? 1\)/);
  assert.doesNotMatch(saveSource, /getPersistableLayerOpacity/);
});

test("GOES y coordenadas usan franjas compactas opuestas sin cambiar la leyenda", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  const setupGoesSource = extractFunctionSource(mapSource, "setupCloudTopPanel");
  const renderGoesSource = extractFunctionSource(mapSource, "renderCloudTopPanel");
  const compactStatusSource = extractFunctionSource(mapSource, "getCloudTopCompactStatus");

  assert.match(html, /map-overlay map-overlay--goes/);
  assert.match(html, /map-overlay map-overlay--coordinates/);
  assert.match(html, /Longitud:[\s\S]*statusbar-lon[\s\S]*Latitud:[\s\S]*statusbar-lat[\s\S]*WGS 84/);
  assert.doesNotMatch(html, /Coordenadas geográficas[\s\S]*WGS 84 \/ EPSG:4326/);
  assert.match(setupGoesSource, /mapStage\.querySelector\("\.map-overlay--goes"\)/);
  assert.match(setupGoesSource, /goesOverlay\.replaceChildren\(indicator\)/);
  assert.match(setupGoesSource, /goes-ir-indicator__line/);
  assert.match(setupGoesSource, /goes-ir-toggle/);
  assert.match(setupGoesSource, /addEventListener\("click", toggleCloudTopVisibility\)/);
  assert.match(setupGoesSource, /<strong>GOES<\/strong>/);
  assert.match(setupGoesSource, /Infrarrojo de nubes/);
  assert.match(setupGoesSource, /NOAA nowCOAST/);
  assert.match(renderGoesSource, /getCloudTopCompactStatus\(frame\)/);
  assert.match(compactStatusSource, /Desactualizado/);
  assert.match(compactStatusSource, /return ""/);
  assert.doesNotMatch(setupGoesSource, /goes-ir-indicator__help/);
  assert.doesNotMatch(setupGoesSource, /goes-ir-indicator__ramp/);
  assert.doesNotMatch(setupGoesSource, /cloud-top-visible|cloud-top-button|cloud-top-toggle/);
  assert.match(cssSource, /\.map-overlay--goes \{[\s\S]*bottom: 18px;/);
  assert.match(cssSource, /\.map-overlay--coordinates \{[\s\S]*right: 178px;[\s\S]*bottom: 38px;/);
  assert.match(cssSource, /\.coordinate-readout \{[\s\S]*display: inline-flex;[\s\S]*pointer-events|\.map-overlay \{[\s\S]*pointer-events: none;/);
  assert.match(cssSource, /\.coordinate-readout \{[\s\S]*display: inline-flex;[\s\S]*white-space: nowrap;/);
  assert.match(cssSource, /\.map-overlay--goes \{[\s\S]*bottom: 70px;[\s\S]*\.map-overlay--coordinates \{[\s\S]*bottom: 42px;/);
  assert.match(cssSource, /\.map-overlay--goes \{[\s\S]*bottom: 68px;[\s\S]*\.map-overlay--coordinates \{[\s\S]*bottom: 40px;/);
  assert.match(cssSource, /\.goes-ir-indicator \{[\s\S]*position: static;[\s\S]*pointer-events: none;/);
  assert.match(cssSource, /\.goes-ir-toggle \{[\s\S]*pointer-events: auto;/);
  assert.match(cssSource, /\.goes-ir-toggle:focus-visible \{/);
  assert.match(cssSource, /\.goes-ir-indicator__line \{[\s\S]*display: inline-flex;[\s\S]*white-space: nowrap;/);
  assert.match(cssSource, /\.map-legend-float \{[\s\S]*width: fit-content;/);
  assert.match(cssSource, /\.map-legend-float__body \{[\s\S]*max-width: min\(190px, calc\(100vw - 36px\)\);/);
  assert.match(cssSource, /\.legend-item \{[\s\S]*padding: 7px 8px;/);
});

test("el boton compacto GOES controla solo la visibilidad satelital sin duplicar temporizadores", () => {
  const setupGoesSource = extractFunctionSource(mapSource, "setupCloudTopPanel");
  const setVisibilitySource = extractFunctionSource(mapSource, "setCloudTopVisibility");
  const updateToggleSource = extractFunctionSource(mapSource, "updateCloudTopToggle");
  const backgroundSource = extractFunctionSource(mapSource, "loadCloudTopFramesInBackground");
  const pollingSource = extractFunctionSource(mapSource, "scheduleCloudTopPolling");
  const renderFrameSource = extractFunctionSource(mapSource, "renderCloudTopFrame");

  assert.equal((setupGoesSource.match(/id="goes-ir-toggle"/g) || []).length, 1);
  assert.match(setupGoesSource, /aria-pressed="true"/);
  assert.match(updateToggleSource, /aria-pressed/);
  assert.match(updateToggleSource, /Desactivar visualización GOES/);
  assert.match(updateToggleSource, /Activar visualización GOES/);
  assert.match(updateToggleSource, /enabled \? "●" : "○"/);
  assert.match(setVisibilitySource, /mapLayer\?\.setVisible\(cloudTop\.userEnabled\)/);
  assert.match(setVisibilitySource, /playback\?\.setVisible\(cloudTop\.userEnabled\)/);
  assert.match(setVisibilitySource, /clearCloudTopPolling\(\)/);
  assert.match(setVisibilitySource, /scheduleCloudTopPolling\(\)/);
  assert.match(backgroundSource, /if \(!cloudTop\.userEnabled/);
  assert.match(pollingSource, /if \(!state\.cloudTop\.userEnabled\) return;/);
  assert.match(renderFrameSource, /if \(!state\.cloudTop\.userEnabled\)/);
  assert.doesNotMatch(setVisibilitySource, /localStorage|sessionStorage/);
  assert.doesNotMatch(setVisibilitySource, /removeLayer|removeSource|toggleLayerVisibility|applyBaseMapVisibility/);
});

test("la barra de herramientas aumenta iconos y reduce separacion sin perder area clicable", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  const toolbarStart = html.indexOf('<div class="map-toolbar" id="map-toolbar"');
  const toolbarEnd = html.indexOf('<p class="toolbar-note"', toolbarStart);
  const toolbarHtml = html.slice(toolbarStart, toolbarEnd);
  const orientationStart = html.indexOf('id="orientation-overlay"');
  const orientationHtml = html.slice(html.lastIndexOf("<div", orientationStart), html.indexOf('<div class="map-overlay map-overlay--goes"', orientationStart));
  const ids = [...toolbarHtml.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(ids.filter((id) => id.startsWith("toolbar-") || id === "trigger-upload" || id === "focus-morelos-menu"), [
    "toolbar-basemap",
    "toolbar-toggle-panel",
    "toolbar-zoom-in",
    "toolbar-zoom-out",
    "toolbar-measure",
    "toolbar-add-point",
    "trigger-upload",
    "focus-morelos-menu",
    "toolbar-clear-measure",
    "toolbar-collapse",
  ]);
  assert.doesNotMatch(toolbarHtml, /toolbar-reset-north|toolbar-fullscreen|toolbar-rotate-left|toolbar-rotate-right|toolbar-pitch-up|toolbar-pitch-down/);
  assert.doesNotMatch(orientationHtml, /id="toolbar-fullscreen"|aria-label="Pantalla completa" title="Pantalla completa"/);
  assert.equal((mapSource.match(/FullscreenControl/g) || []).length, 2);
  assert.doesNotMatch(html, /id="toolbar-fullscreen"/);
  assert.match(orientationHtml, /id="orientation-menu-trigger"[\s\S]*aria-expanded="false"[\s\S]*aria-controls="orientation-menu"/);
  assert.match(orientationHtml, /id="orientation-menu"[\s\S]*role="menu"[\s\S]*hidden/);
  assert.match(orientationHtml, /id="toolbar-rotate-left"[\s\S]*role="menuitem"[\s\S]*aria-label="Rotar a la izquierda"/);
  assert.match(orientationHtml, /id="toolbar-rotate-right"[\s\S]*role="menuitem"[\s\S]*aria-label="Rotar a la derecha"/);
  assert.match(orientationHtml, /id="toolbar-pitch-up"[\s\S]*role="menuitem"[\s\S]*aria-label="Inclinar mapa"/);
  assert.match(orientationHtml, /id="toolbar-pitch-down"[\s\S]*role="menuitem"[\s\S]*aria-label="Reducir inclinación"/);
  assert.match(orientationHtml, /id="toolbar-reset-north"[\s\S]*role="menuitem"[\s\S]*aria-label="Reposicionar al norte"/);
  assert.match(toolbarHtml, /id="toolbar-zoom-in"[\s\S]*aria-label="Acercar mapa"[\s\S]*title="Acercar mapa"/);
  assert.match(toolbarHtml, /id="toolbar-measure"[\s\S]*aria-label="Medir distancia"[\s\S]*title="Medir distancia"/);
  assert.match(toolbarHtml, /M3 7h18v10H3V7/);
  assert.doesNotMatch(toolbarHtml, /M3 17\.25V21/);
  assert.match(toolbarHtml, /id="toolbar-collapse"[\s\S]*aria-label="Comprimir herramientas del visor"[\s\S]*title="Comprimir herramientas"/);
  assert.match(cssSource, /#tools-overlay \{[\s\S]*?display: flex;[\s\S]*?width: fit-content;[\s\S]*?max-width: calc\(100% - 36px\);[\s\S]*?flex-direction: column;[\s\S]*?align-items: center;/);
  assert.match(cssSource, /\.map-toolbar \{[\s\S]*?gap: 5px;[\s\S]*?padding: 8px 10px;/);
  assert.match(cssSource, /\.map-toolbar \{[\s\S]*?width: fit-content;[\s\S]*?max-width: 100%;[\s\S]*?justify-content: center;/);
  assert.match(cssSource, /\.map-toolbar\[hidden\] \{[\s\S]*?display: none;/);
  assert.match(cssSource, /\.toolbar-button \{[\s\S]*?width: 36px;[\s\S]*?height: 36px;/);
  assert.match(cssSource, /\.toolbar-icon \{[\s\S]*?width: 20px;[\s\S]*?height: 20px;/);
  assert.match(cssSource, /\.toolbar-icon svg \{[\s\S]*?width: 20px;[\s\S]*?height: 20px;/);
  assert.match(cssSource, /\.toolbar-button:focus-visible,/);
  assert.match(cssSource, /\.toolbar-compact-trigger:focus-visible,/);
  assert.match(cssSource, /\.orientation-button:focus-visible,/);
  assert.doesNotMatch(cssSource, /\.map-overlay--orientation \{/);
  assert.match(cssSource, /\.orientation-map-control \{[\s\S]*?pointer-events: auto;[\s\S]*?overflow: visible;/);
  assert.match(cssSource, /\.orientation-button \{[\s\S]*?width: 38px;[\s\S]*?height: 38px;/);
  assert.match(cssSource, /\.orientation-control \{[\s\S]*?position: relative;/);
  assert.match(cssSource, /\.orientation-menu \{[\s\S]*?position: absolute;[\s\S]*?left: 50%;[\s\S]*?right: auto;[\s\S]*?bottom: calc\(100% \+ 8px\);[\s\S]*?flex-direction: column;[\s\S]*?transform: translateX\(-50%\);/);
  assert.doesNotMatch(cssSource.match(/^\.orientation-menu \{[\s\S]*?^\}/m)?.[0] ?? "", /right: calc\(100%|bottom: 0;/);
  assert.match(cssSource, /\.orientation-menu\[hidden\] \{[\s\S]*?display: none;/);
  assert.match(cssSource, /@media \(max-height: 500px\) \{[\s\S]*?\.orientation-menu \{[\s\S]*?gap: 4px;[\s\S]*?padding: 4px;[\s\S]*?\.orientation-menu \.orientation-button \{[\s\S]*?width: 32px;[\s\S]*?height: 32px;/);
  assert.match(cssSource, /\.map-toolbar \{[\s\S]*?border-radius: 20px;[\s\S]*?background: rgba\(255, 250, 245, 0\.94\);/);
  assert.match(cssSource, /@media \(max-width: 760px\) \{[\s\S]*?#tools-overlay \{[\s\S]*?left: 50%;[\s\S]*?right: auto;[\s\S]*?transform: translateX\(-50%\);[\s\S]*?\.map-toolbar \{[\s\S]*?width: fit-content;[\s\S]*?justify-content: center;[\s\S]*?gap: 2px;[\s\S]*?\.toolbar-button,[\s\S]*?width: 32px;[\s\S]*?height: 32px;[\s\S]*?\.toolbar-icon,[\s\S]*?width: 18px;[\s\S]*?height: 18px;/);
  assert.doesNotMatch(cssSource.match(/^\.map-toolbar \{[\s\S]*?^\}/m)?.[0] ?? "", /justify-content: space-between;/);
});

test("la barra de herramientas inicia comprimida y conserva un solo temporizador seguro", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  const overlayIdIndex = html.indexOf('id="tools-overlay"');
  const overlayOpenTag = html.slice(html.lastIndexOf("<div", overlayIdIndex), html.indexOf(">", overlayIdIndex) + 1);
  const triggerIdIndex = html.indexOf('id="toolbar-compact-trigger"');
  const triggerOpenTag = html.slice(html.lastIndexOf("<button", triggerIdIndex), html.indexOf(">", triggerIdIndex) + 1);
  const toolbarIdIndex = html.indexOf('id="map-toolbar"');
  const toolbarOpenTag = html.slice(html.lastIndexOf("<div", toolbarIdIndex), html.indexOf(">", toolbarIdIndex) + 1);
  const setupSource = extractFunctionSource(mapSource, "setupToolbarAutoCollapse");
  const collapseSource = extractFunctionSource(mapSource, "collapseToolbar");
  const expandSource = extractFunctionSource(mapSource, "expandToolbar");
  const syncSource = extractFunctionSource(mapSource, "syncToolbarCollapseState");
  const scheduleSource = extractFunctionSource(mapSource, "scheduleToolbarAutoCollapse");
  const canSource = extractFunctionSource(mapSource, "canToolbarAutoCollapse");
  const updateToolbarSource = extractFunctionSource(mapSource, "updateToolbarState");

  assert.match(mapSource, /const TOOLBAR_AUTO_COLLAPSE_MS = 8000;/);
  assert.match(mapSource, /toolbarCollapsed: true/);
  assert.match(mapSource, /toolbarAutoCollapseTimer: null/);
  assert.match(overlayOpenTag, /is-toolbar-collapsed/);
  assert.match(triggerOpenTag, /aria-expanded="false"/);
  assert.match(triggerOpenTag, /aria-controls="map-toolbar"/);
  assert.doesNotMatch(triggerOpenTag, /\shidden(?:\s|>)/);
  assert.match(toolbarOpenTag, /\shidden(?:\s|>)/);
  assert.match(html, /id="toolbar-collapse"[\s\S]*aria-label="Comprimir herramientas del visor"/);
  assert.match(setupSource, /toolbarCompactTrigger\.addEventListener\("click", \(\) => expandToolbar/);
  assert.match(setupSource, /toolbarCollapse\?\.addEventListener\("click", \(\) => collapseToolbar/);
  assert.match(setupSource, /pointerenter/);
  assert.match(setupSource, /pointerleave/);
  assert.match(setupSource, /focusin/);
  assert.match(setupSource, /focusout/);
  assert.match(scheduleSource, /clearToolbarAutoCollapseTimer\(\)/);
  assert.match(scheduleSource, /window\.setTimeout\(\(\) => \{/);
  assert.match(scheduleSource, /TOOLBAR_AUTO_COLLAPSE_MS/);
  assert.match(collapseSource, /state\.toolbarCollapsed = true/);
  assert.match(expandSource, /state\.toolbarCollapsed = false/);
  assert.match(syncSource, /mapToolbar\) elements\.mapToolbar\.hidden = collapsed/);
  assert.match(syncSource, /toolbarCompactTrigger\.hidden = !collapsed/);
  assert.match(syncSource, /aria-expanded/);
  assert.match(syncSource, /uploadPermissionNote\?\.classList\.toggle\("is-hidden", canUpload\(\) \|\| collapsed\)/);
  assert.match(updateToolbarSource, /scheduleToolbarAutoCollapse\(\)/);
  assert.doesNotMatch(collapseSource + expandSource + syncSource, /map\.resize|queueMapResize|localStorage|sessionStorage/);
  assert.doesNotMatch(setupSource, /querySelectorAll\("[^"]*toolbar-compact-trigger/);
});

test("la compresion de herramientas se bloquea durante operaciones activas o navegacion de controles", () => {
  const canSource = extractFunctionSource(mapSource, "canToolbarAutoCollapse");
  const setupSource = extractFunctionSource(mapSource, "setupToolbarAutoCollapse");

  assert.match(canSource, /if \(state\.activeTool\) return false;/);
  assert.match(canSource, /basemapFlyout && !elements\.basemapFlyout\.hidden/);
  assert.match(canSource, /uploadDraft\?\.previewVisible/);
  assert.match(canSource, /uploadLayerModal\?\.open/);
  assert.match(canSource, /toolbarPointerInside && !options\.manual/);
  assert.match(canSource, /toolsOverlay\?\.contains\(document\.activeElement\) && !options\.manual/);
  assert.match(setupSource, /if \(state\.toolbarCollapsed\) expandToolbar\(\);/);
});

test("el menu vertical de orientacion conserva funciones y cierre accesible sin almacenamiento", () => {
  const setupSource = extractFunctionSource(mapSource, "setupUi");
  const mountSource = extractFunctionSource(mapSource, "mountOrientationControl");
  const toggleSource = extractFunctionSource(mapSource, "toggleOrientationMenu");
  const closeSource = extractFunctionSource(mapSource, "closeOrientationMenu");
  const keySource = extractFunctionSource(mapSource, "handleOrientationMenuKeydown");

  assert.match(mapSource, /orientationMenuOpen: false/);
  assert.match(mapSource, /orientationMenuTrigger: document\.getElementById\("orientation-menu-trigger"\)/);
  assert.doesNotMatch(mapSource, /new maplibregl\.NavigationControl|NavigationControl\(/);
  assert.match(mapSource, /map\.addControl\(new maplibregl\.FullscreenControl\(\), "bottom-right"\)/);
  assert.match(mapSource, /mountOrientationControl\(\)/);
  assert.match(mountSource, /classList\.remove\("map-overlay", "map-overlay--orientation"\)/);
  assert.match(mountSource, /classList\.add\("orientation-map-control", "maplibregl-ctrl"\)/);
  assert.match(mountSource, /map\.addControl\(orientationControl, "bottom-right"\)/);
  assert.doesNotMatch(mapSource, /toolbarFullscreen|toggleFullscreen|requestFullscreen|exitFullscreen|fullscreenchange/);
  assert.match(setupSource, /orientationMenuTrigger\?\.addEventListener\("click", toggleOrientationMenu\)/);
  assert.match(setupSource, /orientationMenu\?\.addEventListener\("keydown", handleOrientationMenuKeydown\)/);
  assert.match(setupSource, /state\.orientationMenuOpen[\s\S]*closeOrientationMenu\(\)/);
  assert.match(setupSource, /event\.key === "Escape" && state\.orientationMenuOpen/);
  assert.match(toggleSource, /state\.orientationMenuOpen = true/);
  assert.match(toggleSource, /orientationMenu\.hidden = false/);
  assert.match(toggleSource, /aria-expanded", "true"/);
  assert.match(closeSource, /state\.orientationMenuOpen = false/);
  assert.match(closeSource, /orientationMenu\.hidden = true/);
  assert.match(closeSource, /aria-expanded", "false"/);
  assert.match(keySource, /ArrowDown/);
  assert.match(keySource, /ArrowUp/);
  assert.match(keySource, /Home/);
  assert.match(keySource, /End/);
  assert.equal((htmlSource.match(/id="toolbar-reset-north"/g) || []).length, 1);
  assert.match(htmlSource, /id="orientation-menu"[\s\S]*id="toolbar-reset-north"/);
  assert.match(setupSource, /toolbarResetNorth\.addEventListener\("click", resetMapNorth\)/);
  assert.match(setupSource, /toolbarRotateLeft\.addEventListener\("click", \(\) => rotateMapBy\(-MAP_ROTATION_STEP\)\)/);
  assert.match(setupSource, /toolbarRotateRight\.addEventListener\("click", \(\) => rotateMapBy\(MAP_ROTATION_STEP\)\)/);
  assert.match(setupSource, /toolbarPitchUp\.addEventListener\("click", \(\) => adjustMapPitch\(MAP_PITCH_STEP\)\)/);
  assert.match(setupSource, /toolbarPitchDown\.addEventListener\("click", \(\) => adjustMapPitch\(-MAP_PITCH_STEP\)\)/);
  assert.doesNotMatch(setupSource + toggleSource + closeSource + keySource, /localStorage|sessionStorage|map\.resize|queueMapResize/);
});

test("la pila de activacion controla prioridad de consulta y cierre de popup", () => {
  const activateSource = extractFunctionSource(mapSource, "activateLayerInStack");
  const deactivateSource = extractFunctionSource(mapSource, "deactivateLayerInStack");
  const toggleSource = extractFunctionSource(mapSource, "toggleLayerVisibility");
  const clickSource = extractFunctionSource(mapSource, "getTopThematicPopupHit");
  const vectorSource = extractFunctionSource(mapSource, "getVectorPopupHitForLayer");
  const rasterSource = extractFunctionSource(mapSource, "getRasterPopupHitForLayer");

  assert.match(mapSource, /activeLayerStack:\s*\[\]/);
  assert.match(activateSource, /filter\(\(id\) => id !== layerId\)/);
  assert.match(activateSource, /state\.activeLayerStack\.push\(layerId\)/);
  assert.match(deactivateSource, /filter\(\(id\) => id !== layerId\)/);
  assert.match(toggleSource, /activateLayerInStack\(userLayer\.id\)/);
  assert.match(toggleSource, /deactivateLayerInStack\(userLayer\.id\)/);
  assert.match(toggleSource, /closePopupForLayer\(userLayer\.id\)/);
  assert.match(clickSource, /\[\.\.\.state\.activeLayerStack\]\.reverse\(\)/);
  assert.match(clickSource, /getVectorPopupHitForLayer\(layer, event\)/);
  assert.match(clickSource, /getRasterPopupHitForLayer\(layer, event\.lngLat\)/);
  assert.match(vectorSource, /map\.queryRenderedFeatures\(event\.point, \{ layers: layerIds \}\)/);
  assert.match(rasterSource, /pickTopGroundOverlayHit\(candidates, lngLat, getMapLayerOrder\(\)\)/);
});

test("los poligonos ordinales se dibujan y consultan por intensidad visible superior", () => {
  const addLayerSource = extractFunctionSource(mapSource, "addGeoJsonLayerToMap");
  const vectorSource = extractFunctionSource(mapSource, "getVectorPopupHitForLayer");
  const pickSource = extractFunctionSource(mapSource, "pickTopVectorPopupFeature");
  const normalizeSource = extractFunctionSource(mapSource, "normalizeBackendProcessedGeoJson");
  const sortSource = extractFunctionSource(mapSource, "applyBackendFeatureSortKey");

  assert.match(addLayerSource, /"fill-sort-key": \["coalesce", \["to-number", \["get", "__egemSortKey"\]\], 0\]/);
  assert.match(normalizeSource, /applyBackendFeatureSortKey\(/);
  assert.match(sortSource, /getFeatureVisualPriorityRank\(properties\)/);
  assert.match(vectorSource, /pickTopVectorPopupFeature\(features\)/);
  assert.match(pickSource, /pickTopFeatureByVisualPriority\(popupFeatures\)/);
  assert.match(mapSource, /pickTopFeatureByVisualPriority,/);
});

test("los puntos remotos usan color de icono, relleno KML y fallback en ese orden", () => {
  const addLayerSource = extractFunctionSource(mapSource, "addGeoJsonLayerToMap");

  assert.match(addLayerSource, /layer\.symbology\?\.pointColorExpression \|\| \["coalesce", \["get", "__styleIcon"\], \["get", "__styleFill"\], defaultPointColor\]/);
  assert.match(addLayerSource, /"circle-color": pointColorExpression/);
});

test("No Aplica se pinta en gris solo desde el campo visual resuelto", () => {
  const normalizeSource = extractFunctionSource(mapSource, "normalizeBackendProcessedGeoJson");
  const flagSource = extractFunctionSource(mapSource, "applyNoAplicaDisplayStyleFlag");
  const fieldSource = extractFunctionSource(mapSource, "getNoAplicaStyleField");
  const addLayerSource = extractFunctionSource(mapSource, "addGeoJsonLayerToMap");
  const colorSource = extractFunctionSource(mapSource, "buildNoAplicaDisplayColorExpression");

  assert.match(mapSource, /NO_APLICA_COLOR,/);
  assert.match(mapSource, /isNoAplicaLegendValue,/);
  assert.match(normalizeSource, /applyNoAplicaDisplayStyleFlag\(/);
  assert.match(flagSource, /const styleField = getNoAplicaStyleField\(symbology\)/);
  assert.match(flagSource, /getPropertyValueByAlias\(properties, \[styleField\]\)/);
  assert.match(flagSource, /isNoAplicaLegendValue\(styleValue\)/);
  assert.match(flagSource, /__egemNoAplicaStyle: true/);
  assert.match(fieldSource, /symbology\?\.legend\?\.styleField \|\| symbology\?\.legend\?\.field \|\| symbology\?\.field/);
  assert.match(fieldSource, /!isTechnicalStyleField\(field\)/);
  assert.doesNotMatch(flagSource, /Perlo_Ret|Description|description/);
  assert.match(colorSource, /\["==", \["get", "__egemNoAplicaStyle"\], true\]/);
  assert.match(colorSource, /NO_APLICA_COLOR/);
  assert.equal((addLayerSource.match(/buildNoAplicaDisplayColorExpression/g) || []).length, 3);
  assert.match(addLayerSource, /"fill-color": fillColorExpression/);
  assert.match(addLayerSource, /"line-color": lineColorExpression/);
  assert.match(addLayerSource, /"circle-color": pointColorExpression/);
});

test("el popup informativo tiene propietario unico y ciclo de vida claro", () => {
  const closeSource = extractFunctionSource(mapSource, "closeActiveInfoPopup");
  const unavailableSource = extractFunctionSource(mapSource, "closePopupIfOwnerUnavailable");
  const vectorPopupSource = extractFunctionSource(mapSource, "showVectorFeaturePopup");
  const groundPopupSource = extractFunctionSource(mapSource, "showGroundOverlayPopup");

  assert.match(mapSource, /activeInfoPopup:\s*null/);
  assert.match(mapSource, /function openInfoPopup\(\{ ownerLayerId, resourceType, mapLayerId, overlayId = null, coordinate, html, info \}\)/);
  assert.match(mapSource, /closeActiveInfoPopup\(\);/);
  assert.match(mapSource, /const owner = \{\s*ownerLayerId,\s*resourceType,\s*mapLayerId,\s*overlayId,/);
  assert.match(mapSource, /popup\.on\("close"/);
  assert.match(closeSource, /state\.activeInfoPopup = null/);
  assert.match(unavailableSource, /!isThematicQueryableLayer\(layer\)/);
  assert.match(vectorPopupSource, /resourceType: isImageBackedLayer\(layer\) \? "mixed" : "vector"/);
  assert.match(groundPopupSource, /resourceType: layer\.data\?\.features\?\.length \? "mixed" : "ground-overlay"/);
  assert.doesNotMatch(extractFunctionSource(mapSource, "bindVectorPopup"), /map\.on\("click", layerId/);
});

test("la simbologia usa un unico panel flotante independiente de visibilidad", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  const renderItemSource = extractFunctionSource(mapSource, "renderLayerItem");
  const floatingSource = extractFunctionSource(mapSource, "renderFloatingLegendContent");
  const toggleSource = extractFunctionSource(mapSource, "toggleLayerVisibility");
  const previewSource = extractFunctionSource(mapSource, "previewLayer");

  assert.match(html, /id="map-legend-float"/);
  assert.doesNotMatch(html, /id="legend-panel"/);
  assert.doesNotMatch(html, /id="selected-layer-legend"/);
  assert.doesNotMatch(renderItemSource, /data-toggle-legend/);
  assert.doesNotMatch(renderItemSource, /layer-legend-button/);
  assert.match(floatingSource, /getVectorLayerSymbology\(layer\)/);
  assert.match(floatingSource, /getRasterLayerSymbology\(layer\)/);
  assert.match(mapSource, /buildRasterLegendFallback/);
  assert.match(mapSource, /function closeFloatingLegend\(options = \{\}\)/);
  assert.match(mapSource, /function openFloatingLegendForLayer\(layerId, options = \{\}\)/);
  assert.match(mapSource, /function syncFloatingLegendAfterLayerDeactivation\(layerId\)/);
  assert.match(toggleSource, /openFloatingLegendForLayer\(userLayer\.id, \{ renderCatalog: false, requestId: legendRequestId \}\)/);
  assert.match(toggleSource, /syncFloatingLegendAfterLayerDeactivation\(userLayer\.id\)/);
  assert.match(previewSource, /openFloatingLegendForLayer\(layer\.id, \{ renderCatalog: false \}\)/);
  assert.doesNotMatch(floatingSource, /toggleLayerVisibility/);
  assert.doesNotMatch(floatingSource, /addUserLayerToMap/);
});

test("la leyenda flotante sigue la ultima capa activa y descarta aperturas antiguas", () => {
  const toggleSource = extractFunctionSource(mapSource, "toggleLayerVisibility");
  const deactivateSource = extractFunctionSource(mapSource, "syncFloatingLegendAfterLayerDeactivation");
  const unavailableSource = extractFunctionSource(mapSource, "closeLegendIfLayerUnavailable");

  assert.match(mapSource, /activeLegendRequestId:\s*0/);
  assert.match(toggleSource, /\+\+state\.activeLegendRequestId/);
  assert.match(toggleSource, /const isLatestLegendRequest = legendRequestId === state\.activeLegendRequestId/);
  assert.match(toggleSource, /if \(isLatestLegendRequest\) \{\s*activateLayerInStack\(userLayer\.id\);/s);
  assert.match(toggleSource, /openFloatingLegendForLayer\(userLayer\.id, \{ renderCatalog: false, requestId: legendRequestId \}\)/);
  assert.match(mapSource, /options\.requestId && options\.requestId !== state\.activeLegendRequestId/);
  assert.match(mapSource, /function getTopActiveThematicLayerId\(\)/);
  assert.match(deactivateSource, /const fallbackId = getTopActiveThematicLayerId\(\)/);
  assert.match(unavailableSource, /const fallbackId = getTopActiveThematicLayerId\(\)/);
  assert.match(mapSource, /function closeFloatingLegend\(options = \{\}\) \{\s*state\.activeLegendRequestId \+= 1/s);
});

test("el popup tematico tiene prioridad sobre municipios y conserva atributos utiles", () => {
  const clickSource = extractFunctionSource(mapSource, "handleMapToolClick");
  const staticSource = extractFunctionSource(mapSource, "getTopStaticPopupHit");
  const thematicPopupSource = extractFunctionSource(mapSource, "buildThematicFeaturePopup");
  const thematicAttributesSource = extractFunctionSource(mapSource, "cleanThematicPopupAttributes");
  const technicalSource = extractFunctionSource(mapSource, "isTechnicalPublicAttribute");
  const usableValueSource = extractFunctionSource(mapSource, "isUsablePopupValue");
  const staticPopupSource = extractFunctionSource(mapSource, "showStaticFeaturePopup");
  const vectorPopupSource = extractFunctionSource(mapSource, "showVectorFeaturePopup");
  const municipiosSource = extractFunctionSource(mapSource, "bindMunicipiosPopup");
  const aliasSource = extractFunctionSource(mapSource, "applyBackendAttributeAliases");
  const fieldsSource = mapSource.match(/const THEMATIC_POPUP_FIELDS = \[[\s\S]*?\n  \];/)?.[0] || "";

  assert.match(clickSource, /const thematicHit = getTopThematicPopupHit\(event\);/);
  assert.match(clickSource, /showThematicPopup\(thematicHit, event\.lngLat\);\s*return;/);
  assert.match(clickSource, /const staticHit = getTopStaticPopupHit\(event\);/);
  assert.match(staticSource, /getStaticPopupHitForLayer\("municipios", \["municipios-hit"\], event\)/);
  assert.match(staticSource, /getStaticPopupHitForLayer\("estado", \["estado-fill"\], event\)/);
  assert.match(staticPopupSource, /resourceType: "static"/);
  assert.match(vectorPopupSource, /const cleanedAttributes = cleanThematicPopupAttributes\(props, layer\.legend\);/);
  assert.match(vectorPopupSource, /extra: \[\]/);
  assert.match(vectorPopupSource, /legend: null/);
  assert.match(vectorPopupSource, /html: buildThematicFeaturePopup\(layer\.title, props, layer\.legend\)/);
  assert.match(thematicPopupSource, /<strong>\$\{escapeHtml\(layerName \|\| "Capa seleccionada"\)\}<\/strong>/);
  assert.doesNotMatch(thematicPopupSource, /feature-popup__highlight/);
  assert.match(thematicPopupSource, /Sin información temática disponible\./);
  assert.match(thematicAttributesSource, /parseKmlDescriptionHtmlAttributes/);
  assert.match(thematicAttributesSource, /applyVisibleLegendLabelForPopup\(mergedProperties, legend\)/);
  assert.match(fieldsSource, /label: "Intensidad"[\s\S]*?"Intensid_1"[\s\S]*?fallbackAliases: \["Magni_unid", "MAGNI_UNID", "Magni_uni"\]/);
  assert.doesNotMatch(fieldsSource, /"Intensidad original"/);
  assert.match(usableValueSource, /value === null \|\| value === undefined/);
  assert.match(usableValueSource, /String\(value\)\.trim\(\) !== ""/);
  assert.match(technicalSource, /"gridcode"/);
  assert.match(technicalSource, /"styleurl"/);
  assert.match(technicalSource, /"ogr style"/);
  assert.match(technicalSource, /normalizedKey === "name"/);
  assert.doesNotMatch(aliasSource, /\["Municipio", \["Municipio", "Name", "name"\]\]/);
  assert.doesNotMatch(municipiosSource, /map\.on\("click", "municipios-hit"/);
  assert.doesNotMatch(municipiosSource, /updateInfoPanel/);
});

test("el popup tematico muestra solo cuatro campos en orden y no usa intensidad en el titulo", () => {
  const popupSource = extractFunctionSource(mapSource, "buildThematicFeaturePopup");
  const attributesSource = extractFunctionSource(mapSource, "cleanThematicPopupAttributes");
  const fieldsSource = mapSource.match(/const THEMATIC_POPUP_FIELDS = \[[\s\S]*?\n  \];/)?.[0] || "";

  assert.match(fieldsSource, /label: "Intensidad"[\s\S]*label: "Detalles"[\s\S]*label: "Clasificación"[\s\S]*label: "Amenaza"/);
  assert.doesNotMatch(fieldsSource, /Municipio|Magnitud|Indicador|Fuente|IVS_FINAL|R_P_V_E_A/);
  assert.match(popupSource, /THEMATIC_POPUP_FIELDS\s*\n\s*\.filter/);
  assert.match(popupSource, /<dt>\$\{escapeHtml\(label\)\}:<\/dt>/);
  assert.match(popupSource, /<dd>\$\{escapeHtml\(String\(attributes\[label\]\)\)\}<\/dd>/);
  assert.doesNotMatch(popupSource, /mainAttribute|findMainFeatureAttribute|feature-popup__highlight|Clasificación.*<strong>|Intensidad.*<strong>/s);
  assert.match(attributesSource, /return THEMATIC_POPUP_FIELDS\.reduce/);
});

test("el popup tematico omite campos ausentes, conserva cero y deduplica aliases", () => {
  const lookupSource = extractFunctionSource(mapSource, "buildPopupAttributeLookup");
  const valueSource = extractFunctionSource(mapSource, "getThematicPopupFieldValue");
  const usableSource = extractFunctionSource(mapSource, "isUsablePopupValue");
  const applyVisibleSource = extractFunctionSource(mapSource, "applyVisibleLegendLabelForPopup");
  const genericSource = extractFunctionSource(mapSource, "isGenericPopupLegendLabel");
  const fieldsSource = mapSource.match(/const THEMATIC_POPUP_FIELDS = \[[\s\S]*?\n  \];/)?.[0] || "";

  assert.match(usableSource, /value === null \|\| value === undefined/);
  assert.match(usableSource, /String\(value\)\.trim\(\) !== ""/);
  assert.doesNotMatch(usableSource, /!value/);
  assert.match(lookupSource, /lookup\.has\(normalizedKey\)/);
  assert.match(lookupSource, /sanitizePopupTextValue\(value\)/);
  assert.match(valueSource, /const directValue = getPopupLookupValue\(lookup, field\.aliases\)/);
  assert.match(valueSource, /fallbackAliases/);
  assert.match(valueSource, /field\.acceptsFallback\(fallbackValue\)/);
  assert.match(applyVisibleSource, /isGenericPopupLegendLabel\(visibleLabel\)/);
  assert.match(genericSource, /normalized === "clase"/);
  assert.match(genericSource, /clase sin etiqueta/);
  assert.match(fieldsSource, /"Detalles", "DETALLES", "Detalle", "DETALLE"/);
  assert.match(fieldsSource, /"Clasificación", "Clasificacion", "Fen_Clasif", "FEN_CLASIF"/);
  assert.match(fieldsSource, /"Amenaza", "Ame_Ampl", "AME_AMPL"/);
});

test("el popup tematico sanitiza HTML y descarta campos tecnicos visibles", () => {
  const sanitizerSource = extractFunctionSource(mapSource, "sanitizePopupTextValue");
  const popupSource = extractFunctionSource(mapSource, "buildThematicFeaturePopup");
  const attributesSource = extractFunctionSource(mapSource, "cleanThematicPopupAttributes");

  assert.match(sanitizerSource, /querySelectorAll\("script, style, iframe, object, embed"\)/);
  assert.match(sanitizerSource, /node\.remove\(\)/);
  assert.match(sanitizerSource, /textContent/);
  assert.match(popupSource, /escapeHtml\(String\(attributes\[label\]\)\)/);
  assert.doesNotMatch(popupSource, /innerHTML|setHTML/);
  assert.doesNotMatch(attributesSource, /sourceEntries\.forEach/);
  assert.doesNotMatch(attributesSource, /attributes\[key\]/);
  [
    "styleUrl",
    "OGR_STYLE",
    "__styleFill",
    "__styleIcon",
    "__egemSortKey",
    "R_P_V_E_A",
    "Magni_num",
    "Intens_num",
    "Fenomeno",
    "description",
    "Intensidad original",
  ].forEach((forbidden) => {
    assert.doesNotMatch(popupSource, new RegExp(escapeRegExp(forbidden), "u"));
  });
});

test("el popup tematico mantiene etiquetas completas y valores ajustables", () => {
  assert.match(cssSource, /\.feature-popup__row \{[\s\S]*?grid-template-columns: minmax\(82px, max-content\) minmax\(0, 1fr\);[\s\S]*?gap: 7px;/);
  assert.match(cssSource, /\.feature-popup__row dt \{[\s\S]*?white-space: nowrap;[\s\S]*?overflow-wrap: normal;[\s\S]*?word-break: normal;/);
  assert.match(cssSource, /\.feature-popup__row dd \{[\s\S]*?color: var\(--ink\);[\s\S]*?font-weight: 600;/);
  assert.match(cssSource, /\.feature-popup__row dt,\s*\n\.feature-popup__row dd \{[\s\S]*?align-self: start;[\s\S]*?min-width: 0;[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: break-word;[\s\S]*?word-break: break-word;/);
  assert.match(cssSource, /@media \(max-width: 760px\) \{[\s\S]*?\.feature-popup__row \{[\s\S]*?grid-template-columns: minmax\(82px, max-content\) minmax\(0, 1fr\);[\s\S]*?gap: 6px;[\s\S]*?padding: 5px 9px;/);
  assert.match(cssSource, /\.maplibregl-popup-content \{[\s\S]*?width: 250px;[\s\S]*?max-width: 250px;/);
  assert.match(cssSource, /\.feature-popup \{[\s\S]*?max-width: 250px;[\s\S]*?overflow: hidden;/);
});

test("el popup raster y los limites conservan rutas separadas", () => {
  const thematicSource = extractFunctionSource(mapSource, "showThematicPopup");
  const staticSource = extractFunctionSource(mapSource, "showStaticFeaturePopup");
  const rasterSource = extractFunctionSource(mapSource, "showGroundOverlayPopup");
  const rasterPopupSource = extractFunctionSource(mapSource, "buildGroundOverlayPopup");

  assert.match(thematicSource, /showVectorFeaturePopup\(hit, lngLat\)/);
  assert.match(thematicSource, /showGroundOverlayPopup\(hit, lngLat\)/);
  assert.match(staticSource, /html: buildFeaturePopup\(title, props\)/);
  assert.match(rasterSource, /html: buildGroundOverlayPopup\(layer\)/);
  assert.match(rasterPopupSource, /Imagen raster georreferenciada/);
  assert.doesNotMatch(rasterPopupSource, /Sin información temática disponible/);
});

test("la presentacion de leyenda omite encabezados categoricos redundantes", () => {
  const renderLegendSource = extractFunctionSource(mapSource, "renderLayerLegend");
  const shouldRenderSource = extractFunctionSource(mapSource, "shouldRenderLegendField");
  const descriptorSource = extractFunctionSource(mapSource, "getLegendClassDescriptor");

  assert.match(renderLegendSource, /shouldRenderLegendField\(legend\)/);
  assert.match(shouldRenderSource, /legend\.type === "continuous"/);
  assert.match(shouldRenderSource, /"susceptibilidad"/);
  assert.match(shouldRenderSource, /"peligro"/);
  assert.match(shouldRenderSource, /"riesgo"/);
  assert.match(shouldRenderSource, /"vulnerabilidad"/);
  assert.doesNotMatch(renderLegendSource, /<p class="info-copy"><strong>\$\{escapeHtml\(legend\.field\)\}<\/strong><\/p>\s*\$\{items\}/);
  assert.match(descriptorSource, /legendTextsAreEquivalent\(item\.label, item\.value\)/);
});

test("la leyenda flotante separa cabecera y cuerpo compacto sin cambiar las clases", () => {
  const floatingSource = extractFunctionSource(mapSource, "renderFloatingLegend");
  const floatingContentSource = extractFunctionSource(mapSource, "renderFloatingLegendContent");
  const renderLegendSource = extractFunctionSource(mapSource, "renderLayerLegend");

  assert.match(floatingSource, /map-legend-float__header/);
  assert.match(floatingSource, /map-legend-float__body/);
  assert.match(floatingSource, /map-legend-float__heading/);
  assert.match(floatingSource, /map-legend-float__title/);
  assert.match(floatingSource, /title="\$\{escapeHtml\(layer\.title\)\}"/);
  assert.match(floatingSource, /aria-label="\$\{escapeHtml\(layer\.title\)\}"/);
  assert.match(floatingSource, /data-close-floating-legend aria-label="Cerrar simbología"/);
  assert.match(floatingContentSource, /renderLayerLegend\(vectorLegend, \{ compact: true, hideField: true \}\)/);
  assert.match(floatingContentSource, /renderLayerLegend\(rasterLegend, \{ compact: true, hideField: true \}\)/);
  assert.doesNotMatch(floatingContentSource, /Simbología vectorial/);
  assert.doesNotMatch(floatingContentSource, /Simbología raster/);
  assert.match(renderLegendSource, /function renderLayerLegend\(legend, options = \{\}\)/);
  assert.match(renderLegendSource, /legend-list--compact/);
  assert.match(renderLegendSource, /legend-item--compact/);
  assert.match(renderLegendSource, /aria-hidden="true"/);
  assert.match(renderLegendSource, /!options\.hideField && shouldRenderLegendField\(legend\)/);
  assert.match(renderLegendSource, /getLegendClassDescriptor\(item, legend\)/);
});

test("el cuerpo compacto de simbologia no hereda el ancho de la cabecera", () => {
  assert.match(cssSource, /\.map-legend-float \{[\s\S]*?width: fit-content;[\s\S]*?max-width: min\(320px, calc\(100vw - 36px\)\);[\s\S]*?justify-items: center;/);
  assert.match(cssSource, /\.map-legend-float__header \{[\s\S]*?position: relative;[\s\S]*?display: block;[\s\S]*?width: min\(260px, calc\(100vw - 36px\)\);[\s\S]*?padding: 8px 34px 7px;/);
  assert.match(cssSource, /\.map-legend-float__heading \{[\s\S]*?text-align: center;/);
  assert.match(cssSource, /\.map-legend-float__header \.section-kicker \{[\s\S]*?text-align: center;/);
  assert.match(cssSource, /\.map-legend-float__title \{[\s\S]*?text-align: center;/);
  assert.match(cssSource, /\.map-legend-float__header \[data-close-floating-legend\] \{[\s\S]*?position: absolute;[\s\S]*?top: 7px;[\s\S]*?right: 7px;/);
  assert.match(cssSource, /\.map-legend-float__body \{[\s\S]*?width: fit-content;[\s\S]*?min-width: 150px;[\s\S]*?max-width: min\(190px, calc\(100vw - 36px\)\);/);
  assert.match(cssSource, /\.legend-list--compact \{[\s\S]*?width: fit-content;[\s\S]*?min-width: 138px;/);
  assert.match(cssSource, /\.legend-item--compact \{[\s\S]*?grid-template-columns: 18px max-content;[\s\S]*?width: fit-content;/);
  assert.match(cssSource, /\.legend-item--compact strong \{[\s\S]*?white-space: nowrap;/);
  assert.match(cssSource, /\.map-legend-float \{[\s\S]*?top: 82px;[\s\S]*?right: 10px;[\s\S]*?left: auto;[\s\S]*?max-width: calc\(100vw - 20px\);[\s\S]*?\.map-legend-float__header \{[\s\S]*?width: min\(260px, calc\(100vw - 20px\)\);/);
  assert.match(cssSource, /\.map-legend-float \{[\s\S]*?right: 6px;[\s\S]*?left: auto;[\s\S]*?max-width: calc\(100vw - 12px\);[\s\S]*?\.map-legend-float__header \{[\s\S]*?width: min\(260px, calc\(100vw - 12px\)\);/);
});

test("el visor inicia con capas tematicas apagadas aunque existan preferencias antiguas", () => {
  const prefsSource = extractFunctionSource(mapSource, "loadPersistedLayerPreferences");
  const renderSource = extractFunctionSource(mapSource, "renderVisibleLayers");
  const buildCatalogSource = extractFunctionSource(mapSource, "buildCatalog");

  assert.match(mapSource, /async function syncLayersFromBackend\(options = \{\}\)/);
  assert.match(mapSource, /preserveSessionVisibility = options\.preserveSessionVisibility !== false/);
  assert.match(mapSource, /const visible = preserveSessionVisibility\s*\?\s*previousVisibility\.get\(layer\.backendLayerId \|\| layer\.id\) === true\s*:\s*false/s);
  assert.doesNotMatch(mapSource, /preference\?\.visible\s*\?\?\s*isPublishedStatus\(layer\.status\)/);
  assert.match(prefsSource, /opacity:\s*clampLayerOpacity\(item\.opacity \?\? 1\)/);
  assert.match(prefsSource, /visible:\s*Boolean\(item\.visible\)/);
  assert.match(renderSource, /if \(layer\.visible !== false && canSeeLayer\(layer\)\)/);
  assert.match(renderSource, /canRenderLayerFromCachedResources\(layer\)/);
  assert.match(mapSource, /function resetThematicRuntimeState\(options = \{\}\)/);
  assert.match(mapSource, /layer\.visible = false/);
  assert.match(mapSource, /state\.activeLayerStack = \[\]/);
  assert.match(mapSource, /closeActiveInfoPopup\(\)/);
  assert.match(mapSource, /closeFloatingLegend\(\{ renderCatalog: false \}\)/);
  assert.match(mapSource, /id: "estado"[\s\S]*?visible: true/);
  assert.match(mapSource, /id: "municipios"[\s\S]*?visible: true/);
  assert.doesNotMatch(mapSource, /layer\.visible = preference\.visible/);
  assert.match(buildCatalogSource, /staticLayers\.map/);
  assert.match(buildCatalogSource, /userLayers\.map/);
});

test("cambios de sesion y administracion no reactivan capas tematicas", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  const logoutSource = extractFunctionSource(mapSource, "logout");
  const initializeSource = extractFunctionSource(mapSource, "initializeRemoteState");
  const approveSource = extractFunctionSource(mapSource, "approveLayer");
  const publishSource = extractFunctionSource(mapSource, "togglePublishLayer");
  const rejectSource = extractFunctionSource(mapSource, "rejectLayer");

  assert.match(mapSource, /syncLayersFromBackend\(\{ preserveSessionVisibility: false \}\)/);
  assert.match(logoutSource, /resetThematicRuntimeState\(\)/);
  assert.match(initializeSource, /syncLayersFromBackend\(\{ preserveSessionVisibility: false \}\)/);
  assert.match(approveSource, /syncLayersFromBackend\(\{ preserveSessionVisibility: false \}\)/);
  assert.match(publishSource, /syncLayersFromBackend\(\{ preserveSessionVisibility: false \}\)/);
  assert.match(rejectSource, /syncLayersFromBackend\(\{ preserveSessionVisibility: false \}\)/);
  assert.match(mapSource, /await syncLayersFromBackend\(\{ preserveSessionVisibility: false \}\);\s*\n\s*const hydrated = state\.userLayers\.find/);
  assert.match(mapSource, /activeLayerStack:\s*\[\]/);
  assert.match(mapSource, /activeInfoPopup:\s*null/);
  assert.match(html, /id="map-legend-float"/);
});

test("la carga diferida evita descargar GeoJSON de capas apagadas y reutiliza una solicitud en vuelo", () => {
  const hydrateSource = extractFunctionSource(mapSource, "hydrateBackendLayer");
  const deferredSource = extractFunctionSource(mapSource, "createDeferredProcessedGeoJsonLayerFromBackend");
  const ensureSource = extractFunctionSource(mapSource, "ensureLayerResourcesLoaded");
  const loadSource = extractFunctionSource(mapSource, "loadProcessedGeoJsonForLayer");
  const toggleSource = extractFunctionSource(mapSource, "toggleLayerVisibility");
  const previewSource = extractFunctionSource(mapSource, "previewLayer");
  const renderItemSource = extractFunctionSource(mapSource, "renderLayerItem");

  assert.match(hydrateSource, /createDeferredProcessedGeoJsonLayerFromBackend\(record\)/);
  assert.doesNotMatch(hydrateSource, /await createProcessedGeoJsonLayerFromBackend\(record\)/);
  assert.match(deferredSource, /data:\s*null/);
  assert.match(deferredSource, /processedGeojsonUrl:\s*record\.processedGeojsonUrl/);
  assert.match(ensureSource, /state\.pendingLayerLoads\.has\(layer\.id\)/);
  assert.match(ensureSource, /state\.pendingLayerLoads\.set\(layer\.id, loadPromise\)/);
  assert.match(ensureSource, /layer\.isLoading = true/);
  assert.match(loadSource, /fetch\(layer\.processedGeojsonUrl\)/);
  assert.match(loadSource, /layer\.data = normalizedRemote\.geojson/);
  assert.match(toggleSource, /await ensureLayerResourcesLoaded\(userLayer\)/);
  assert.match(toggleSource, /userLayer\.visible = false/);
  assert.match(previewSource, /await ensureLayerResourcesLoaded\(layer\)/);
  assert.match(renderItemSource, /Cargando capa\.\.\./);
  assert.match(renderItemSource, /layer\.isLoading \? "disabled"/);
});

test("el backend puede entregar leyenda vectorial de catalogo sin modificar la capa", async () => {
  const layerServiceSource = await fs.readFile(path.resolve("backend/src/modules/layers/layers.service.js"), "utf8");

  assert.match(layerServiceSource, /const vectorLegendPreviewCache = new Map\(\)/);
  assert.match(layerServiceSource, /function buildVectorLegendPreview\(properties = \{\}\)/);
  assert.match(layerServiceSource, /function resolveProcessedGeojsonPath\(value\)/);
  assert.match(layerServiceSource, /path\.resolve\(process\.cwd\(\), \"\.\.\", rawPath\)/);
  assert.match(layerServiceSource, /processedGeojsonPath/);
  assert.match(layerServiceSource, /__styleFill/);
  assert.match(layerServiceSource, /getInstitutionalPreviewColor\(label\)/);
  assert.match(layerServiceSource, /getHtmlDescriptionAttribute\(properties\.Description \|\| properties\.description, \"Intensidad\"\)/);
  assert.match(layerServiceSource, /getHtmlDescriptionAttribute\(properties\.Description \|\| properties\.description, \"Intensid_1\"\)/);
  assert.match(layerServiceSource, /function getDominantVectorLegendConcept\(features = \[\]\)/);
  assert.match(layerServiceSource, /"muy baja": "#006100"/);
  assert.match(layerServiceSource, /"muy alta": "#ff2200"/);
  assert.match(layerServiceSource, /vectorLegend/);
  assert.match(layerServiceSource, /metadata:\s*layer\.metadata[\s\S]*vectorLegend/);
  assert.match(mapSource, /record\.vectorLegend/);
  assert.match(mapSource, /metadata\?\.properties\?\.vectorLegend/);
});

test("la opacidad tematica conserva minimo 10 y maximo 100", () => {
  const clampSource = extractFunctionSource(mapSource, "clampLayerOpacity");
  const renderItemSource = extractFunctionSource(mapSource, "renderLayerItem");
  const clampLayerOpacity = Function(`return (${clampSource});`)();

  assert.match(clampSource, /Math\.max\(0\.1, numeric\)/);
  assert.match(clampSource, /Math\.min\(1,/);
  assert.match(clampSource, /if \(!Number\.isFinite\(numeric\)\) return 1/);
  assert.match(renderItemSource, /type="range" min="10" max="100" step="5"/);
  assert.doesNotMatch(renderItemSource, /min="0"/);
  assert.equal(clampLayerOpacity(0), 0.1);
  assert.equal(clampLayerOpacity(0.05), 0.1);
  assert.equal(clampLayerOpacity(0.1), 0.1);
  assert.equal(clampLayerOpacity(0.5), 0.5);
  assert.equal(clampLayerOpacity(1), 1);
  assert.equal(clampLayerOpacity(1.4), 1);
  assert.equal(clampLayerOpacity(Number.NaN), 1);
  assert.equal(clampLayerOpacity("invalido"), 1);
});

test("los correos institucionales propios usan dominio egem", async () => {
  const htmlSource = await fs.readFile(path.resolve("index.html"), "utf8");
  assert.doesNotMatch(mapSource, /@atlas\.morelos/);
  assert.doesNotMatch(htmlSource, /@atlas\.morelos/);
  assert.match(mapSource, /admin@egem\.morelos/);
  assert.match(htmlSource, /usuario@egem\.morelos/);
});

test("no quedan separadores mojibakeados en textos publicos", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  const mojibakeSeparator = String.fromCodePoint(0x00c3, 0x0192, 0x00e2, 0x20ac, 0x0161, 0x00c3, 0x201a, 0x00c2, 0x00b7);
  assert.equal(html.includes(mojibakeSeparator), false);
  assert.equal(mapSource.includes(mojibakeSeparator), false);
  assert.doesNotMatch(extractFunctionSource(mapSource, "renderLayerItem"), /&middot;| · /u);
});
