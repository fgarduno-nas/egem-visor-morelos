import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { adminResourceType, safeAdminSymbology, safeAdminProcessingMessage } from "../backend/src/modules/layers/admin-layer-details.js";
import { renderAdminLayerDetail, adminDetailDate } from "../js/app/utils/admin-layer-detail.js";

test("legacy resource type is inferred only from available evidence", () => {
  assert.equal(adminResourceType({}, null, null), null);
  assert.equal(adminResourceType({}, null, "tiff"), "raster");
  assert.equal(adminResourceType({}, "Point", "kmz"), "vector");
  assert.equal(adminResourceType({groundOverlays:[{}]}, "Point", "kmz"), "mixed");
  assert.equal(adminResourceType({groundOverlays:[{}]}, null, "kmz"), "ground-overlay");
});

test("administrative legends project classes/items/legacy arrays without private fields", () => {
  for (const wrap of [classes => ({classes,field:"Riesgo"}), classes => ({items:classes}), classes => classes]) {
    const properties = { vectorLegend:wrap([{label:"Pozo",displayLabel:"Pozo revisado",color:"#112233",displayColor:"#334455",geometryRole:"pozo",order:2,iconHref:"/private/icon.png",passwordHash:"secret",stack:"secret"}]),rasterLegend:{classes:[{label:"Alto",color:"#ff0000",order:1}]} };
    const sym = safeAdminSymbology(properties,"mixed","Point");
    assert.equal(sym.vectorClassCount,1); assert.equal(sym.rasterClassCount,1);
    assert.equal(sym.vector.classes[0].symbol,"triangle"); assert.equal(sym.vector.classes[0].label,"Pozo revisado");
    assert.equal(sym.vector.classes[0].color,"#334455"); assert.equal(sym.vector.classes[0].originalColor,"#112233");
    assert.doesNotMatch(JSON.stringify(sym),/private|passwordHash|secret|stack|iconHref/);
    assert.equal(safeAdminSymbology(properties,"vector","Point").raster,null);
    assert.equal(safeAdminSymbology(properties,"raster",null).vector,null);
  }
});

test("detail contains captured fields, Morelos dates, technical fields and visual symbols", () => {
  const symbology=safeAdminSymbology({vectorLegend:{field:"Clases",classes:[{label:"Manantial",color:"#ff00ff",geometryRole:"manantial",order:1},{label:"Pozo",color:"#00ffff",geometryRole:"pozo",order:2}]}},"vector","Point");
  const html=renderAdminLayerDetail({title:"Puntos",description:"Descripción capturada",municipality:"Morelos",phenomenon:"category:geologicos",source:"Fuente institucional",responsibleAgency:"Protección Civil",sourceUpdatedAt:"2026",scaleOrResolution:"1:50,000",capturedCrs:"EPSG:4326",crs:"EPSG:4326",createdAt:"2026-09-29T16:00:00Z",updatedAt:"2026-09-29T17:00:00Z",status:"published",processingStatus:"processed",isVisualizable:true,resourceType:"vector",geometryType:"Point",featureCount:863,submittedBy:{name:"Responsable",email:"admin@example.test"},files:[{originalName:"Puntos.kmz",extension:"kmz",mimeType:"application/zip"}],symbology});
  for(const value of ["Puntos.kmz","Geológicos","Descripción capturada","Morelos","Fuente institucional","Protección Civil","2026","1:50,000","EPSG:4326","admin@example.test","Publicada","Procesada","863","Círculo","Triángulo","<circle","<path","Volver a la tabla"]) assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/category:|Leyenda raster/);
  assert.match(adminDetailDate("2026-09-29T16:00:00Z"),/29\/09\/2026.*10:00/);
});

test("missing legacy values are explicit and malicious content is escaped", () => {
  const html=renderAdminLayerDetail({title:'<img src=x onerror="evil()">',description:{secret:123},featureCount:null,submittedBy:{},files:[]});
  assert.match(html,/&lt;img/); assert.match(html,/No especificado/);
  assert.doesNotMatch(html,/<img|undefined|null|\[object Object\]|secret|category:/);
  assert.equal(adminDetailDate("bad"),"No especificado");
  assert.equal(adminDetailDate(null),"No especificado");
  const message=safeAdminProcessingMessage({processingStatus:"failed",processingError:"password=secret at /srv/private/stack.js:123"});
  assert.match(message,/No se pudo procesar/);assert.doesNotMatch(message,/secret|password|srv|stack/);
});

test("raster and mixed details display only applicable legends and preserve class order", () => {
  for(const resourceType of ["raster","ground-overlay","mixed"]) {
    const p={vectorLegend:{classes:[{label:"Vector",color:"#000000",order:1}]},rasterLegend:{field:"Rangos",classes:[{label:"Baja",color:"#00ff00",order:1},{label:"Alta",color:"#ff0000",order:2}]}};
    const html=renderAdminLayerDetail({resourceType,symbology:safeAdminSymbology(p,resourceType,"Polygon")});
    assert.match(html,/Leyenda raster/); assert.ok(html.indexOf("Baja")<html.indexOf("Alta"));assert.match(html,/<rect/);
    assert.equal(html.includes("Leyenda vectorial"),resourceType==="mixed");
  }
});

test("table has seven columns including all placeholder rows and retains processing filter", async () => {
  const html=await fs.readFile("index.html","utf8"), map=await fs.readFile("js/map.js","utf8"),css=await fs.readFile("css/style.css","utf8");
  const table=html.match(/<table class="admin-layer-table">[\s\S]*?<\/table>/)[0];
  assert.equal((table.match(/<th scope=/g)||[]).length,7);assert.doesNotMatch(table,/Procesamiento/);assert.match(table,/colspan="7"/);
  const row=map.slice(map.indexOf("function renderAdminLayerTableRow"),map.indexOf("function showAdminLayerTableDetails"));
  assert.equal((row.match(/<td[ >]/g)||[]).length,7);assert.doesNotMatch(row,/getProcessingStatus/);
  const rendering=map.slice(map.indexOf("function renderAdminLayerTable()"),map.indexOf("function renderAdminLayerTableRow"));
  assert.equal((rendering.match(/colspan="7"/g)||[]).length,3);
  assert.match(html,/id="admin-layer-processing"/);
  for(const size of [10,20,50])assert.match(html,new RegExp(`value="${size}"`));
  const wrap=css.match(/\.admin-layer-table-wrap \{[^}]+\}/)[0];assert.match(wrap,/overflow-y: hidden/);assert.doesNotMatch(wrap,/max-height|height: clamp/);
});
