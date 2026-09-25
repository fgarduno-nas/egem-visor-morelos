import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const source = await fs.readFile(path.resolve("backend/src/modules/layers/layers.service.js"), "utf8");
const routesSource = await fs.readFile(path.resolve("backend/src/modules/layers/layers.routes.js"), "utf8");
const controllerSource = await fs.readFile(path.resolve("backend/src/modules/layers/layers.controller.js"), "utf8");
const schemasSource = await fs.readFile(path.resolve("backend/src/modules/layers/layers.schemas.js"), "utf8");
const appSource = await fs.readFile(path.resolve("backend/src/app.js"), "utf8");
const assetMiddlewareSource = await fs.readFile(path.resolve("backend/src/modules/layers/layer-assets.middleware.js"), "utf8");
const publicPolicySource = await fs.readFile(path.resolve("backend/src/modules/layers/layer-public-policy.js"), "utf8");
const rasterLegendScriptSource = await fs.readFile(path.resolve("backend/scripts/detect-raster-legend.js"), "utf8");

function extractFunctionSource(name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `No se encontro ${name}`);
  const start = match.index;
  const signatureEnd = source.indexOf(")", start);
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

function buildBackendHelpers() {
  class AppError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  const helperSource = [
    extractFunctionSource("normalizeOptionalText"),
    extractFunctionSource("normalizeHexColor"),
    extractFunctionSource("parseRasterLegend"),
    extractFunctionSource("buildVectorLegendClassIdentity"),
    extractFunctionSource("normalizeLegendIdentityPart"),
    extractFunctionSource("normalizeSafeIconReference"),
    extractFunctionSource("normalizeVectorLegendClassOrders"),
    extractFunctionSource("buildVectorLegendOrderGroupKey"),
    extractFunctionSource("compareVectorLegendOrder"),
    extractFunctionSource("isOrdinalVectorLegendGroup"),
    extractFunctionSource("getSemanticVectorLegendOrder"),
    extractFunctionSource("parseVectorLegend"),
    extractFunctionSource("getHtmlDescriptionAttribute"),
    extractFunctionSource("getVectorLegendPreviewLabel"),
    extractFunctionSource("getVectorLegendPreviewOrder"),
    extractFunctionSource("getDominantVectorLegendConcept"),
    extractFunctionSource("getVectorLegendPreviewField"),
    "const ROLE_CODES = { ADMIN: 'ADMIN', DATA_PROVIDER: 'DATA_PROVIDER' };",
    extractFunctionSource("assertLayerDeletable"),
    "return { parseRasterLegend, parseVectorLegend, getVectorLegendPreviewLabel, getVectorLegendPreviewField, assertLayerDeletable, AppError };",
  ].join("\n");

  return Function("AppError", helperSource)(AppError);
}

const helpers = buildBackendHelpers();

test("parseRasterLegend conserva titulo, valores, orden y colores exactos", () => {
  const legend = helpers.parseRasterLegend(JSON.stringify({
    field: "Inestabilidad",
    classes: [
      { value: 5, label: "Muy Alta", color: "#ff2200", order: 5 },
      { value: 1, label: "Muy Baja", color: "#006100", order: 1 },
    ],
  }));

  assert.equal(legend.field, "Inestabilidad");
  assert.deepEqual(legend.classes.map((item) => item.value), ["1", "5"]);
  assert.deepEqual(legend.classes.map((item) => item.label), ["Muy Baja", "Muy Alta"]);
  assert.deepEqual(legend.classes.map((item) => item.color), ["#006100", "#ff2200"]);
});

test("parseRasterLegend mantiene compatibilidad con arreglo antiguo", () => {
  const legend = helpers.parseRasterLegend(JSON.stringify([
    { label: "Baja", color: "#7aab00" },
    { label: "Alta", color: "#ff9900" },
  ]));

  assert.equal(legend.field, "Simbología raster");
  assert.deepEqual(legend.classes.map((item) => item.label), ["Baja", "Alta"]);
});

test("parseRasterLegend rechaza colores duplicados", () => {
  assert.throws(
    () => helpers.parseRasterLegend(JSON.stringify({
      field: "Inestabilidad",
      classes: [
        { label: "Baja", color: "#7aab00", order: 1 },
        { label: "Alta", color: "#7aab00", order: 2 },
      ],
    })),
    /colores duplicados/,
  );
});

test("preview vectorial usa Intensid_1 sin convertirlo automaticamente en Peligro", () => {
  const description = "<table><tr><td>Intensid_1</td><td>Muy alto</td></tr><tr><td>R_P_V_E_A</td><td>Susceptibilidad</td></tr></table>";
  const label = helpers.getVectorLegendPreviewLabel({ Name: "17", description });
  const field = helpers.getVectorLegendPreviewField([{ label, color: "#ff2200", order: 5 }], [
    { properties: { description } },
  ]);

  assert.equal(label, "Muy alto");
  assert.equal(field, "Susceptibilidad");
});

test("preview vectorial solo usa Peligro cuando el concepto dominante es Peligro", () => {
  const description = "<table><tr><td>Intensid_1</td><td>Muy alto</td></tr><tr><td>R_P_V_E_A</td><td>Peligro</td></tr></table>";
  const label = helpers.getVectorLegendPreviewLabel({ Name: "17", description });
  const field = helpers.getVectorLegendPreviewField([{ label, color: "#ff2200", order: 5 }], [
    { properties: { description } },
  ]);

  assert.equal(label, "Muy alto");
  assert.equal(field, "Peligro");
});

test("backend expone actualizacion acotada de rasterLegend para capas existentes", () => {
  const updateSource = extractFunctionSource("updateLayerRasterLegend");

  assert.match(routesSource, /"\/:id\/raster-legend"/);
  assert.match(routesSource, /authorizeRoles\(ROLE_CODES\.ADMIN\)/);
  assert.match(controllerSource, /updateLayerRasterLegendController/);
  assert.match(schemasSource, /rasterLegendSchema/);
  assert.match(updateSource, /rasterLegend = parseRasterLegend/);
  assert.match(updateSource, /properties:\s*\{\s*\.\.\.metadataProperties,\s*rasterLegend,/);
  assert.doesNotMatch(updateSource, /groundOverlays:\s*\[/);
  assert.doesNotMatch(updateSource, /files:\s*\{/);
});

test("uploadLayer persiste leyenda raster automatica sin sobrescribir una explicita", () => {
  assert.match(source, /const processing = await processUploadedLayer\(created, files\)/);
  assert.match(source, /const rasterLegend = parseUploadRasterLegendForProcessing\(body\.rasterLegend, processing\)/);
  assert.match(source, /const persistedRasterLegend = rasterLegend \|\| processing\.rasterLegend \|\| null/);
  assert.match(source, /const persistedVectorLegend = vectorLegend \|\| processing\.vectorLegend \|\| null/);
  assert.match(source, /rasterLegend:\s*persistedRasterLegend/);
  assert.match(source, /vectorLegend:\s*persistedVectorLegend/);
  assert.match(source, /rasterLegendDetection:\s*processing\.rasterLegendDiagnostics/);
  assert.match(source, /rasterLegend:\s*metadataProperties\.rasterLegend \?\? null/);
  assert.match(source, /vectorLegend = metadataProperties\.vectorLegend \?\? buildVectorLegendPreview/);
  assert.match(schemasSource, /vectorLegend:\s*z\.string\(\)\.max\(30000\)/);
});

test("backend solo valida rasterLegend manual cuando el procesamiento es raster o mixto", () => {
  const uploadSource = extractFunctionSource("uploadLayer");
  const applicabilitySource = extractFunctionSource("isRasterLegendApplicableToProcessing");
  const parseUploadSource = extractFunctionSource("parseUploadRasterLegendForProcessing");

  assert.doesNotMatch(uploadSource, /const rasterLegend = parseRasterLegend\(body\.rasterLegend\)/);
  assert.match(uploadSource, /parseUploadRasterLegendForProcessing\(body\.rasterLegend, processing\)/);
  assert.match(applicabilitySource, /resourceType === "ground-overlay"/);
  assert.match(applicabilitySource, /resourceType === "raster"/);
  assert.match(applicabilitySource, /resourceType === "mixed"/);
  assert.match(applicabilitySource, /processing\.groundOverlays/);
  assert.match(parseUploadSource, /if \(!isRasterLegendApplicableToProcessing\(processing\)\) return null/);
  assert.match(parseUploadSource, /return parseRasterLegend\(value\)/);
});

test("parseVectorLegend identifica clases por identidad tecnica y permite colores compartidos", () => {
  const parseSource = extractFunctionSource("parseVectorLegend");
  const identitySource = extractFunctionSource("buildVectorLegendClassIdentity");

  assert.match(parseSource, /buildVectorLegendClassIdentity\(item, parsed\)/);
  assert.match(parseSource, /normalizeVectorLegendClassOrders\(classes, parsed\)/);
  assert.match(parseSource, /originalLabel:\s*label/);
  assert.match(parseSource, /originalColor:\s*color/);
  assert.match(parseSource, /displayColor:\s*normalizeHexColor\(item\?\.displayColor\) \|\| color/);
  assert.doesNotMatch(parseSource, /`\$\{label\.toLowerCase\(\)\}\|\$\{color\}`/);
  assert.doesNotMatch(parseSource, /colores duplicados/);
  assert.doesNotMatch(parseSource, /órdenes duplicadas/);
  assert.match(identitySource, /item\?\.group \|\| item\?\.folder/);
  assert.match(identitySource, /item\?\.legendField \|\| legend\?\.styleField \|\| legend\?\.field/);
  assert.match(identitySource, /item\?\.originalValue \|\| item\?\.value/);
  assert.match(identitySource, /item\?\.styleId \|\| item\?\.styleUrl/);
  assert.match(identitySource, /item\?\.symbolType/);
  assert.match(identitySource, /item\?\.geometryRole/);
  assert.match(identitySource, /item\?\.iconHref/);

  const legend = helpers.parseVectorLegend(JSON.stringify({
    field: "Simbología",
    styleField: "Intensidad",
    classes: [
      { label: "Manantial", displayLabel: "Manantiales", color: "#73dfff", displayColor: "#7c3aed", order: 1, group: "Manantial", symbolType: "icon", styleId: "IconStyle10" },
      { label: "Estanque", color: "#73dfff", order: 1, group: "Estanque", symbolType: "color", geometryRole: "estanque", styleId: "PolyStyle20" },
      { label: "Muy Bajo", color: "#38a800", order: 1, group: "Descargas sin tratamientos", legendField: "Intensidad", originalValue: "Muy Bajo", symbolType: "color" },
      { label: "Muy Alto", color: "#ff0000", order: 1, group: "Descargas sin tratamientos", legendField: "Intensidad", originalValue: "Muy Alto", symbolType: "color" },
      { label: "Alto", color: "#ff0000", order: 1, group: "Descargas sin tratamientos", legendField: "Intensidad", originalValue: "Alto", symbolType: "color" },
      { label: "Medio", color: "#ffff00", order: 1, group: "Descargas sin tratamientos", legendField: "Intensidad", originalValue: "Medio", symbolType: "color" },
      { label: "Bajo", color: "#98e600", order: 1, group: "Descargas sin tratamientos", legendField: "Intensidad", originalValue: "Bajo", symbolType: "color" },
      { label: "Alto duplicado", color: "#ff0000", order: 1, group: "Descargas sin tratamientos", legendField: "Intensidad", originalValue: "Alto", symbolType: "color" },
    ],
  }));

  assert.deepEqual(legend.classes.map((item) => item.label), ["Manantial", "Estanque", "Muy Alto", "Alto", "Medio", "Bajo", "Muy Bajo"]);
  assert.deepEqual(legend.classes.map((item) => item.order), [1, 1, 1, 2, 3, 4, 5]);
  assert.deepEqual(legend.classes.map((item) => item.displayOrder), [1, 1, 1, 2, 3, 4, 5]);
  assert.deepEqual(legend.classes.map((item) => item.sourceOrder), [1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(legend.classes.map((item) => item.color), ["#73dfff", "#73dfff", "#ff0000", "#ff0000", "#ffff00", "#98e600", "#38a800"]);
  assert.equal(legend.classes[0].label, "Manantial");
  assert.equal(legend.classes[0].originalLabel, "Manantial");
  assert.equal(legend.classes[0].displayLabel, "Manantiales");
  assert.equal(legend.classes[0].color, "#73dfff");
  assert.equal(legend.classes[0].originalColor, "#73dfff");
  assert.equal(legend.classes[0].displayColor, "#7c3aed");
});

test("mapLayer expone rasterLegend sin publicar diagnosticos internos", () => {
  const mapLayerSource = extractFunctionSource("mapLayer");

  assert.match(mapLayerSource, /rasterLegendDetection,/);
  assert.match(mapLayerSource, /processedGeojsonPath,/);
  assert.match(mapLayerSource, /geospatialDiagnostics,/);
  assert.match(mapLayerSource, /\.\.\.publicMetadataProperties/);
  assert.match(mapLayerSource, /\.\.\.publicMetadataProperties/);
  assert.doesNotMatch(mapLayerSource, /\.\.\.metadataProperties,\s*vectorLegend/);
});

test("script administrativo de rasterLegend es explicito, diagnostico e idempotente", () => {
  assert.match(rasterLegendScriptSource, /--file <ruta\.kmz>/);
  assert.match(rasterLegendScriptSource, /--id <layerId>/);
  assert.match(rasterLegendScriptSource, /--apply/);
  assert.match(rasterLegendScriptSource, /--help/);
  assert.match(rasterLegendScriptSource, /dryRun: !options\.apply/);
  assert.match(rasterLegendScriptSource, /NODE_ENV === "production" && !options\.allowProduction/);
  assert.match(rasterLegendScriptSource, /hasValidManualRasterLegend/);
  assert.doesNotMatch(rasterLegendScriptSource, /findMany/);
});

test("backend protege recursos privados y conserva acceso publico solo para publicados", () => {
  assert.match(appSource, /app\.get\("\/uploads\/\*", serveLayerAsset\)/);
  assert.doesNotMatch(appSource, /express\.static\(env\.UPLOAD_BASE_DIR/);
  assert.match(assetMiddlewareSource, /isLayerAssetPublic = isLayerPubliclyAccessible/);
  assert.match(publicPolicySource, /layer\.status !== LAYER_STATUS\.PUBLISHED/);
  assert.match(publicPolicySource, /readCanonicalBoolean\(layer, "isVisualizable"\) === true/);
  assert.match(publicPolicySource, /readCanonicalString\(layer, "processingStatus"\) === "processed"/);
  assert.match(publicPolicySource, /hasOwnProperty\.call\(layer, field\)/);
  assert.match(assetMiddlewareSource, /verifyAccessToken/);
  assert.match(assetMiddlewareSource, /ROLE_CODES\.ADMIN/);
  assert.match(assetMiddlewareSource, /layer\.createdById === actor\.sub/);
  assert.match(assetMiddlewareSource, /Cache-Control", isPublic \? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL/);
  assert.match(assetMiddlewareSource, /resolveUploadPath/);
  assert.match(assetMiddlewareSource, /hasTraversalSegment/);
  assert.match(assetMiddlewareSource, /isAllowedAssetFile/);
  assert.match(assetMiddlewareSource, /startsWith\(`\$\{uploadRoot\}\$\{path\.sep\}`\)/);
});

test("DELETE permite director autenticado y el servicio limita al propietario", () => {
  const deleteSource = extractFunctionSource("deleteLayer");
  const assertDeleteSource = extractFunctionSource("assertLayerDeletable");
  const layer = { createdById: "director-propietario" };

  assert.match(routesSource, /layersRouter\.delete\(\s*"\/:id",\s*authorizeRoles\(ROLE_CODES\.ADMIN, ROLE_CODES\.DATA_PROVIDER\)/);
  assert.match(deleteSource, /assertLayerDeletable\(layer, actor\)/);
  assert.match(deleteSource, /actor\.role === ROLE_CODES\.ADMIN \? "admin" : "owner"/);
  assert.match(assertDeleteSource, /throw new AppError\("Token de autenticación requerido\.", 401\)/);
  assert.match(assertDeleteSource, /actor\.role === ROLE_CODES\.ADMIN/);
  assert.match(assertDeleteSource, /actor\.role === ROLE_CODES\.DATA_PROVIDER && layer\.createdById === actor\.sub/);
  assert.match(assertDeleteSource, /throw new AppError\("No tienes permisos para eliminar esta capa\.", 403\)/);

  assert.doesNotThrow(() => helpers.assertLayerDeletable(layer, { role: "DATA_PROVIDER", sub: "director-propietario" }));
  assert.doesNotThrow(() => helpers.assertLayerDeletable(layer, { role: "ADMIN", sub: "admin" }));
  assert.throws(
    () => helpers.assertLayerDeletable(layer, { role: "DATA_PROVIDER", sub: "otro-director" }),
    (error) => error.status === 403 && /No tienes permisos/.test(error.message),
  );
  assert.throws(
    () => helpers.assertLayerDeletable(layer, null),
    (error) => error.status === 401 && /Token de autenticación requerido/.test(error.message),
  );
  assert.match(deleteSource, /throw new AppError\("Capa no encontrada\.", 404\)/);
});

test("detalle y GeoJSON de capas pendientes aplican autorizacion por actor", () => {
  const getDetailSource = source.match(/export async function getLayerDetail[\s\S]*?return mapLayer[\s\S]*?\n\}/)?.[0] ?? "";
  const getGeoJsonSource = source.match(/export async function getLayerGeoJson[\s\S]*?catch \(_error\)[\s\S]*?\n\}/)?.[0] ?? "";
  const assertSource = extractFunctionSource("assertLayerReadable");

  assert.match(controllerSource, /getLayerDetail\(req\.validated\.params\.id, req\.user\)/);
  assert.match(controllerSource, /getLayerGeoJson\(req\.validated\.params\.id, req\.user\)/);
  assert.match(getDetailSource, /assertLayerReadable\(layer, actor\)/);
  assert.match(getGeoJsonSource, /assertLayerReadable\(layer, actor\)/);
  assert.match(assertSource, /layer\.status === LAYER_STATUS\.PUBLISHED/);
  assert.match(assertSource, /throw new AppError\("Token de autenticación requerido\.", 401\)/);
  assert.match(assertSource, /actor\.role === ROLE_CODES\.ADMIN/);
  assert.match(assertSource, /layer\.createdById === actor\.sub/);
  assert.match(assertSource, /throw new AppError\("No tienes permisos para consultar esta capa\.", 403\)/);
});

test("DTO administrativo expone remitente seguro y el publico no filtra rutas internas", () => {
  const mapLayerSource = extractFunctionSource("mapLayer");
  const safeUserSource = extractFunctionSource("mapSafeUser");

  assert.match(mapLayerSource, /audience === "admin"/);
  assert.match(mapLayerSource, /audience === "owner"/);
  assert.match(mapLayerSource, /base\.submittedBy = mapSafeUser/);
  assert.match(mapLayerSource, /base\.reviewStatus = layer\.status/);
  assert.match(mapLayerSource, /publicUrl: isPublished \|\| includeOwner \? buildPublicFileUrl/);
  assert.doesNotMatch(mapLayerSource, /storagePath:\s*file\.storagePath/);
  assert.doesNotMatch(mapLayerSource, /\/opt\/|C:\\\\|passwordHash|accessToken|refreshToken/);
  assert.match(mapLayerSource, /processedGeojsonPath,/);
  assert.match(mapLayerSource, /geospatialDiagnostics,/);
  assert.match(mapLayerSource, /normalizePublicGroundOverlays/);
  assert.match(mapLayerSource, /approvals: includeOwner/);
  assert.match(safeUserSource, /Usuario no disponible/);
  assert.match(safeUserSource, /includeEmail/);
  assert.doesNotMatch(safeUserSource, /passwordHash|JWT|secret/i);
  assert.match(source, /filter\(isLayerPubliclyAccessible\)/);
  assert.match(source, /processingStatus = Object\.prototype\.hasOwnProperty\.call\(layer, "processingStatus"\)/);
  assert.match(source, /isVisualizable = Object\.prototype\.hasOwnProperty\.call\(layer, "isVisualizable"\)/);
});
