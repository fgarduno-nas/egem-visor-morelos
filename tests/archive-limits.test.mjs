import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { ARCHIVE_LIMITS as L, validateArchiveSizes } from "../shared/archive-limits.js";
import { MAX_UPLOAD_BYTES, UPLOAD_SIZE_ERROR } from "../shared/upload-limits.js";
import { validateArchiveEntries as front } from "../js/app/utils/geospatial-importer.js";
import { analyzeKmzFile as analyzeClientKmz, analyzeGeospatialFile } from "../js/app/utils/geospatial-importer.js";
import { MAX_CLIENT_KML_PREVIEW_BYTES } from "../shared/archive-limits.js";
import { validateArchiveEntries as back, readZipEntryBuffer } from "../backend/src/modules/layers/geospatial-importer.service.js";

const entry = (uncompressedSize, compressedSize = Math.ceil(uncompressedSize / 10)) => ({name: "doc.kml", uncompressedSize, compressedSize});
function both(entries, compressedSize) {
  front(entries.map(({name, ...sizes}) => ({name, _data:sizes})), compressedSize);
  back(entries);
}

test("archivo afectado: los mismos tamaños declarados pasan en ambos importadores", () => {
  assert.doesNotThrow(() => both([entry(129486449,15923784), {...entry(5485,1298),name:"estilos.xsl"}],15925342));
});

test("128 MiB por entrada es inclusivo, +1 se rechaza en ambos", () => {
  for(const size of [L.maxSingleEntryBytes-1,L.maxSingleEntryBytes]) assert.doesNotThrow(()=>both([entry(size)]));
  assert.throws(()=>both([entry(L.maxSingleEntryBytes+1)]), /entrada interna.*128 MiB/);
  assert.throws(()=>back([entry(L.maxSingleEntryBytes+1)]), /entrada interna.*128 MiB/);
});

test("total 450 MiB inclusivo y rechazo por total distinto del límite por entrada", () => {
  const entries=Array.from({length:4},()=>entry(100*1024*1024));
  entries.push(entry(50*1024*1024));
  assert.doesNotThrow(()=>both(entries));
  entries[4].uncompressedSize++;
  assert.throws(()=>both(entries), /total.*450 MiB/);
  assert.throws(()=>back(entries), /total.*450 MiB/);
});

test("compresión 100:1 inclusiva y razón abusiva rechazada en ambos", () => {
  assert.doesNotThrow(()=>both([entry(10000,100)]));
  assert.throws(()=>both([entry(10001,100)]), /100:1/);
  assert.throws(()=>back([entry(10001,100)]), /100:1/);
  assert.throws(()=>both([entry(1,0)]), /100:1/);
});

test("250 entradas inclusivas; se conservan restricciones de rutas y metadatos", () => {
  assert.doesNotThrow(()=>both(Array.from({length:250},()=>entry(10,10))));
  assert.throws(()=>both(Array.from({length:251},()=>entry(10,10))), /250 entradas/);
  assert.throws(()=>back(Array.from({length:251},()=>entry(10,10))), /250 entradas/);
  assert.throws(()=>both([{...entry(10),name:"../doc.kml"}]), /ruta no segura/);
  assert.throws(()=>back([{...entry(10),name:"../doc.kml"}]), /ruta no segura/);
  assert.throws(()=>validateArchiveSizes([entry(-1)]), /tamaños internos inválidos/);
});

test("archivo comprimido conserva 50 MiB aunque el contenido interno sea pequeño", () => {
  assert.doesNotThrow(()=>front([{name:"doc.kml",_data:entry(100)}], MAX_UPLOAD_BYTES));
  assert.throws(()=>front([{name:"doc.kml",_data:entry(100)}], MAX_UPLOAD_BYTES+1), {message:UPLOAD_SIZE_ERROR});
});

test("backend verifica el tamaño realmente inflado, no solo la cabecera ZIP", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"egem-archive-"));
  const file=path.join(dir,"entry.zip");
  const data=zlib.deflateRawSync(Buffer.from("contenido real"));
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);
  fs.writeFileSync(file,Buffer.concat([header,data]));
  try {
    const item={...entry(14,data.length),localHeaderOffset:0,compressionMethod:8};
    assert.equal(readZipEntryBuffer(file,item).toString(),"contenido real");
    assert.throws(()=>readZipEntryBuffer(file,{...item,uncompressedSize:1}), /tamaño declarado/);
  } finally {fs.unlinkSync(file);fs.rmdirSync(dir);}
});

test("vista previa: KMZ grande se valida sin inflar su KML y conserva el archivo para el servidor", async () => {
  const previous=globalThis.window;
  const file={name:"Inundaciones Pluviales.kmz",size:15925342};
  globalThis.window={JSZip:{loadAsync:async selected=>{
    assert.equal(selected,file);
    return {files:{"doc.kml":{name:"doc.kml",_data:{compressedSize:15923784,uncompressedSize:129486449},async:()=>assert.fail("No debe inflar el KML en la vista previa")}}};
  }}};
  try {
    const result=await analyzeClientKmz(file);
    assert.equal(result.requiresServerProcessing,true);
    assert.equal(result.canPreview,false);
    assert.match(result.message,/32 MiB.*se conserva.*servidor/);
    assert.equal(file.size,15925342);
  } finally {globalThis.window=previous;}
});

test("KML directo grande también difiere su vista previa antes de leer texto", async () => {
  const result=await analyzeGeospatialFile({name:"grande.kml",size:MAX_CLIENT_KML_PREVIEW_BYTES+1,text:()=>assert.fail("No debe construir XML")});
  assert.equal(result.requiresServerProcessing,true);
  const small=await analyzeGeospatialFile({name:"pequeno.kml",size:200,text:async()=>'<kml><Placemark><Point><coordinates>-99,18</coordinates></Point></Placemark></kml>'});
  assert.equal(small.canPreview,true);
  assert.equal(small.vector.geometryCount,1);
});

test("formulario diferido conserva selección y nombre editable para poder enviar sin vista previa", async () => {
  const source=fs.readFileSync(new URL("../js/map.js",import.meta.url),"utf8");
  const start=source.indexOf("  async function refreshUploadDraftPreview() {");
  const end=source.indexOf("  function clearUploadDraftPreview()",start);
  const file={name:"Inundaciones Pluviales.kmz"};
  const state={uploadDraft:{files:[file],previewLayers:[],previewVisible:false}};
  const elements={uploadLayerTitle:{value:""},uploadLayerFeedback:{textContent:""}};
  const refresh=new Function("state","elements","clearUploadDraftPreview","createLayersFromFiles","syncUploadDraftUi",`${source.slice(start,end)};return refreshUploadDraftPreview;`)(
    state,elements,()=>{},async()=>{throw Object.assign(new Error("Procesamiento en servidor"),{code:"SERVER_PREVIEW_REQUIRED"});},()=>{}
  );
  await refresh();
  assert.equal(state.uploadDraft.files[0],file);
  assert.equal(elements.uploadLayerTitle.value,"Inundaciones Pluviales");
  assert.equal(state.uploadDraft.serverPreviewRequired,true);
  assert.equal(state.uploadDraft.previewLayers.length,0);
  elements.uploadLayerTitle.value="Nombre elegido";
  await refresh();
  assert.equal(elements.uploadLayerTitle.value,"Nombre elegido");
});
