import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const modulePath = path.resolve("js/app/utils/remote-style-utils.js");
const moduleSource = await fs.readFile(modulePath, "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`;
const mapSource = await fs.readFile(path.resolve("js/map.js"), "utf8");
const cssSource = await fs.readFile(path.resolve("css/style.css"), "utf8");
const htmlSource = await fs.readFile(path.resolve("index.html"), "utf8");
const municipiosGeojson = JSON.parse(await fs.readFile(path.resolve("data/base/municipios.geojson"), "utf8"));

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

function walkCoordinatePairs(coordinates, callback) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === "number") {
    callback(coordinates);
    return;
  }
  coordinates.forEach((child) => walkCoordinatePairs(child, callback));
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
  assert.match(staticSource, /"line-color": "#efe4c6"/);
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
  assert.match(mapSource, /estado-highlight-halo/);
  assert.match(mapSource, /estado-highlight/);
  assert.match(mapSource, /"line-color": "#10212B"/);
  assert.match(mapSource, /"line-color": "#00E5FF"/);
  assert.match(mapSource, /const color = layer\.id === "estado" \? "#00E5FF"/);
  assert.match(mapSource, /function restoreStateBoundaryHighlight/);
  assert.match(mapSource, /const visible = staticLayers\.find\(\(layer\) => layer\.id === "estado"\)\?\.visible !== false/);
  assert.match(mapSource, /safeSetLayoutProperty\("estado-highlight-halo", "visibility", visible \? "visible" : "none"\)/);
  assert.match(mapSource, /safeSetLayoutProperty\("estado-highlight", "visibility", visible \? "visible" : "none"\)/);
  assert.match(mapSource, /map\.moveLayer\(layerId\)/);
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
  const ids = [...toolbarHtml.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(ids.filter((id) => id.startsWith("toolbar-") || id === "trigger-upload" || id === "focus-morelos-menu"), [
    "toolbar-basemap",
    "toolbar-toggle-panel",
    "toolbar-zoom-in",
    "toolbar-zoom-out",
    "toolbar-reset-north",
    "toolbar-fullscreen",
    "toolbar-rotate-left",
    "toolbar-rotate-right",
    "toolbar-pitch-up",
    "toolbar-pitch-down",
    "toolbar-measure",
    "toolbar-add-point",
    "trigger-upload",
    "focus-morelos-menu",
    "toolbar-clear-measure",
    "toolbar-collapse",
  ]);
  assert.match(toolbarHtml, /id="toolbar-zoom-in"[\s\S]*aria-label="Acercar mapa"[\s\S]*title="Acercar mapa"/);
  assert.match(toolbarHtml, /id="toolbar-measure"[\s\S]*aria-label="Medir distancia entre dos puntos"[\s\S]*title="Medir distancia entre dos puntos"/);
  assert.match(toolbarHtml, /id="toolbar-collapse"[\s\S]*aria-label="Comprimir herramientas del visor"[\s\S]*title="Comprimir herramientas"/);
  assert.match(cssSource, /\.map-toolbar \{[\s\S]*?gap: 5px;[\s\S]*?padding: 8px 10px;/);
  assert.match(cssSource, /\.map-toolbar\[hidden\] \{[\s\S]*?display: none;/);
  assert.match(cssSource, /\.toolbar-button \{[\s\S]*?width: 36px;[\s\S]*?height: 36px;/);
  assert.match(cssSource, /\.toolbar-icon \{[\s\S]*?width: 20px;[\s\S]*?height: 20px;/);
  assert.match(cssSource, /\.toolbar-icon svg \{[\s\S]*?width: 20px;[\s\S]*?height: 20px;/);
  assert.match(cssSource, /\.toolbar-button:focus-visible,/);
  assert.match(cssSource, /\.toolbar-compact-trigger:focus-visible,/);
  assert.match(cssSource, /\.map-toolbar \{[\s\S]*?border-radius: 20px;[\s\S]*?background: rgba\(255, 250, 245, 0\.94\);/);
  assert.match(cssSource, /@media \(max-width: 760px\) \{[\s\S]*?\.map-toolbar \{[\s\S]*?gap: 2px;[\s\S]*?\.toolbar-button,[\s\S]*?width: 32px;[\s\S]*?height: 32px;[\s\S]*?\.toolbar-icon,[\s\S]*?width: 18px;[\s\S]*?height: 18px;/);
});

test("la barra de herramientas inicia abierta y se comprime con un solo temporizador seguro", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  const setupSource = extractFunctionSource(mapSource, "setupToolbarAutoCollapse");
  const collapseSource = extractFunctionSource(mapSource, "collapseToolbar");
  const expandSource = extractFunctionSource(mapSource, "expandToolbar");
  const syncSource = extractFunctionSource(mapSource, "syncToolbarCollapseState");
  const scheduleSource = extractFunctionSource(mapSource, "scheduleToolbarAutoCollapse");
  const canSource = extractFunctionSource(mapSource, "canToolbarAutoCollapse");
  const updateToolbarSource = extractFunctionSource(mapSource, "updateToolbarState");

  assert.match(mapSource, /const TOOLBAR_AUTO_COLLAPSE_MS = 8000;/);
  assert.match(mapSource, /toolbarCollapsed: false/);
  assert.match(mapSource, /toolbarAutoCollapseTimer: null/);
  assert.match(html, /id="toolbar-compact-trigger"[\s\S]*aria-expanded="false"[\s\S]*aria-controls="map-toolbar"[\s\S]*hidden/);
  assert.match(html, /id="map-toolbar"/);
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
