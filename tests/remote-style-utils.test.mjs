import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const modulePath = path.resolve("js/app/utils/remote-style-utils.js");
const moduleSource = await fs.readFile(modulePath, "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`;
const mapSource = await fs.readFile(path.resolve("js/map.js"), "utf8");
const cssSource = await fs.readFile(path.resolve("css/style.css"), "utf8");

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
  const openBrace = source.indexOf("{", start);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`No se pudo extraer ${name}`);
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
    "#166534",
    0.2,
    "#65A30D",
    0.4,
    "#FACC15",
    0.6,
    "#F97316",
    0.8,
    "#DC2626",
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
  assert.match(visibleText, /Coordinacion Estatal de Proteccion Civil Morelos/);
  assert.match(visibleText, /Universidad Autonoma del Estado de Morelos/);
});

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
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  assert.match(html, /<div class="basemap-control">\s*<button[\s\S]*id="toolbar-basemap"/);
  assert.match(html, /id="toolbar-basemap"[\s\S]*<\/button>\s*<div class="basemap-flyout" id="basemap-flyout" hidden>/);
  assert.match(html, /aria-label="Elegir fondo cartografico"/);
  assert.match(html, /id="basemap-flyout"/);
  assert.doesNotMatch(html, /id="basemap-panel"/);
  assert.doesNotMatch(html, /id="basemap-list"/);
  assert.equal((html.match(/id="basemap-flyout"/g) || []).length, 1);
  assert.equal((html.match(/class="basemap-list/g) || []).length, 1);
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
  assert.match(mapSource, /function restoreStateBoundaryHighlight/);
  assert.match(mapSource, /map\.moveLayer\(layerId\)/);
});

test("la seleccion de capa esta separada de visibilidad y muestra simbologia", () => {
  const renderCatalogSource = extractFunctionSource(mapSource, "renderLayerCatalog");
  assert.match(mapSource, /function selectLayer/);
  assert.match(renderCatalogSource, /event\.target\.closest\("button, input, label, a"\)/);
  assert.match(mapSource, /data-select-layer/);
  assert.match(mapSource, /revealSelectedLayerLegend/);
  assert.match(mapSource, /aria-pressed/);
  assert.match(mapSource, /renderSelectedLayerLegend/);
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
  assert.match(renderCatalogSource, /updateLayerOpacity\(event\.target\.dataset\.opacity, Number\(event\.target\.value\)\)/);
});

test("las descripciones permanecen para datos internos pero no se insertan en la tarjeta publica", () => {
  const renderItemSource = extractFunctionSource(mapSource, "renderLayerItem");
  const resolveCategorySource = extractFunctionSource(mapSource, "resolveLayerCategory");

  ["Contorno general del estado de Morelos", "Division municipal para consulta operativa"].forEach((description) => {
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
  assert.match(mapSource, /Las capas tematicas no estan disponibles temporalmente/);
  assert.match(mapSource, /Por el momento no hay capas tematicas publicadas/);
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

test("no quedan separadores mojibakeados en textos publicos", async () => {
  const html = await fs.readFile(path.resolve("index.html"), "utf8");
  assert.doesNotMatch(html, /Ã‚Â·/u);
  assert.doesNotMatch(mapSource, /Ã‚Â·/u);
  assert.doesNotMatch(extractFunctionSource(mapSource, "renderLayerItem"), /&middot;| · /u);
});
