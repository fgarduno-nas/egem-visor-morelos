import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { acquireUploadSlot, guardedUpload } from "../backend/src/modules/layers/upload-control.js";
import { findUploadRetry, uploadFingerprint } from "../backend/src/modules/layers/upload-retry.js";
import { uploadRetryKey, confirmUploadRetry } from "../js/app/services/upload-retry-key.js";

process.env.MAX_UPLOAD_SIZE_MB="50";process.env.NODE_ENV="test";
process.env.DATABASE_URL="postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET="test-only-not-a-production-secret";
process.env.DEFAULT_ADMIN_EMAIL="test@example.com";process.env.DEFAULT_ADMIN_PASSWORD="test-only-password";process.env.DEFAULT_ADMIN_NAME="Test upload";
const root=await fs.mkdtemp(path.join(os.tmpdir(),"egem-reliability-"));
process.env.UPLOAD_BASE_DIR=root;
const require=createRequire(new URL("../backend/package.json",import.meta.url));
const express=require("express");
const {upload}=await import("../backend/src/config/upload.js");
const {errorMiddleware}=await import("../backend/src/middlewares/error.middleware.js");
const {runProcessingWorker,summarizeUploadOffThread}=await import("../backend/src/modules/layers/layer-processing-runner.js");
const exec=promisify(execFile);

test.after(async()=>{await fs.rm(root,{recursive:true,force:true});});
const data='{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[-99,18]}}]}';
const requestHeaders=()=>({"Idempotency-Key":crypto.randomUUID()});
function form(){const f=new FormData();f.append("files",new Blob([data]),"prueba.geojson");return f;}
async function waitUntil(check){for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,10));}assert.fail("No terminó la operación aislada");}

test("reserva exclusiva entre procesos y fallo cerrado si queda un archivo de reserva",async()=>{
 const dir=await fs.mkdtemp(path.join(root,"lock-"));const release=await acquireUploadSlot(dir);
 const url=new URL("../backend/src/modules/layers/upload-control.js",import.meta.url).href;
 const script=`const {acquireUploadSlot}=await import(${JSON.stringify(url)});try{await acquireUploadSlot(${JSON.stringify(dir)});process.exit(2)}catch(e){if(e.statusCode!==503)throw e;}`;
 await exec(process.execPath,["--input-type=module","-e",script]);
 await assert.rejects(acquireUploadSlot(dir),e=>e.statusCode===503);
 await release();await release();const again=await acquireUploadSlot(dir);await again();
});

test("interfaz anterior o clave inválida se rechaza antes de recibir archivos",async()=>{
 const handler=guardedUpload(root,()=>assert.fail("No debe comenzar multipart"),()=>assert.fail(),()=>assert.fail());
 for(const [key,status] of [[undefined,409],["invalid",400]]){
  let error;await handler({get:()=>key},{},e=>{error=e;});assert.equal(error.statusCode,status);
 }
});

test("un entorno distinto de 50 MiB se rechaza en el arranque",async()=>{
 const url=new URL("../backend/src/config/env.js",import.meta.url).href;
 await assert.rejects(exec(process.execPath,["--input-type=module","-e",`await import(${JSON.stringify(url)})`],{env:{...process.env,MAX_UPLOAD_SIZE_MB:"100"}}),error=>error.code===1&&error.stderr.includes("MAX_UPLOAD_SIZE_MB"));
});

test("el worker procesa GeoJSON sin retener el event loop de la API",async()=>{
 const filename=path.join(root,"real.geojson");await fs.writeFile(filename,data);
 let yielded=false;setImmediate(()=>{yielded=true;});
 const result=await runProcessingWorker({id:"worker-test",title:"Prueba",sourceType:"geojson"},[{path:filename,originalname:"prueba.geojson"}]);
 assert.equal(result.processingStatus,"processed");assert.equal(result.featureCount,1);assert.equal(yielded,true);
 const summary=await summarizeUploadOffThread([{path:filename}],"geojson");
 assert.deepEqual(summary,{featureCount:1,geometryType:"Point"});
});

test("error no controlado del worker se propaga después de terminar su hilo",async()=>{
 await assert.rejects(runProcessingWorker({id:"invalid-worker",sourceType:"geojson"},{}),/map is not a function/);
});

test("validación fallida elimina temporales y libera reserva",async()=>{
 const app=express();app.post("/upload",guardedUpload(root,upload.array("files",10),(_q,_r,next)=>next(Object.assign(new Error("Metadatos inválidos"),{statusCode:400})),()=>assert.fail()));app.use(errorMiddleware);
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 try{const res=await fetch(`http://127.0.0.1:${server.address().port}/upload`,{method:"POST",headers:requestHeaders(),body:form()});assert.equal(res.status,400);
 const release=await acquireUploadSlot(root);await release();
 const entries=await fs.readdir(root,{recursive:true});assert.equal(entries.some(name=>name.endsWith("prueba.geojson")&&name!=="real.geojson"),false);
 }finally{await new Promise(r=>server.close(r));}
});

test("cancelar durante procesamiento no libera el turno ni permite otra conversión",async()=>{
 let start,finish;const started=new Promise(r=>{start=r;});const finishing=new Promise(r=>{finish=r;});
 const app=express();app.post("/upload",guardedUpload(root,upload.array("files",10),(_q,_r,next)=>next(),async(_q,res)=>{start();await finishing;res.json({ok:true});}));app.use(errorMiddleware);
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));const url=`http://127.0.0.1:${server.address().port}/upload`;
 const abort=new AbortController();const first=fetch(url,{method:"POST",headers:requestHeaders(),body:form(),signal:abort.signal}).catch(e=>e);
 try{await started;abort.abort();await first;
 const busy=await fetch(url,{method:"POST",headers:requestHeaders(),body:form()});assert.equal(busy.status,503);assert.equal(busy.headers.get("retry-after"),"15");
 finish();await waitUntil(async()=>!(await fs.readdir(path.join(root,".runtime"))).includes("layer-upload.lock"));
 const release=await acquireUploadSlot(root);await release();
 }finally{finish();await new Promise(r=>server.close(r));}
});

test("cancelar durante recepción cierra el archivo parcial, lo elimina y libera reserva",async()=>{
 let seen;const incoming=new Promise(r=>{seen=r;});
 const app=express();app.post("/upload",guardedUpload(root,(req,res,next)=>{req.once("data",()=>seen());upload.array("files",10)(req,res,next);},(_q,_r,next)=>next(),()=>assert.fail()));app.use(errorMiddleware);
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const request=http.request({host:"127.0.0.1",port:server.address().port,path:"/upload",method:"POST",headers:{...requestHeaders(),"Content-Type":"multipart/form-data; boundary=abort-test"}});request.on("error",()=>{});
 request.write('--abort-test\r\nContent-Disposition: form-data; name="files"; filename="parcial.geojson"\r\nContent-Type: application/geo+json\r\n\r\n'+data);
 try{await incoming;request.destroy();await waitUntil(async()=>!(await fs.readdir(path.join(root,".runtime"))).includes("layer-upload.lock"));
 await waitUntil(async()=>!(await fs.readdir(root,{recursive:true})).some(name=>name.endsWith("parcial.geojson")));
 }finally{request.destroy();await new Promise(r=>server.close(r));}
});

test("clave de reintento estable; cambios en metadatos o archivo generan otra clave",async()=>{
 const file={name:"original.kmz",size:15925342,lastModified:123};
 const first=await uploadRetryKey({title:"A"},[file]);assert.equal(await uploadRetryKey({title:"A"},[file]),first);
 assert.notEqual(await uploadRetryKey({title:"B"},[file]),first);
 assert.notEqual(await uploadRetryKey({title:"A"},[{...file,size:2}]),first);
 await confirmUploadRetry({title:"A"},[file]);
 assert.notEqual(await uploadRetryKey({title:"A"},[file]),first);
});

test("cliente conserva la clave tras pérdida de conexión y la libera tras confirmar el resultado",async()=>{
 const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
 globalThis.window={__EGEM_CONFIG__:{},location:{hostname:"localhost"}};
 const {uploadLayerRequest}=await import("../js/app/services/layers-api.js");
 const seen=[];let attempt=0;
 globalThis.fetch=async(_url,options)=>{
  if(options.method==="GET")return new Response(JSON.stringify({data:{version:1}}));
  seen.push(options.headers["Idempotency-Key"]);
  if(attempt++===0)throw new TypeError("Conexión perdida (simulada)");
  return new Response(JSON.stringify({data:{id:"same-record"}}));
 };
 const metadata={title:"Prueba de reintento",tags:[]};const files=[new File([data],"retry.geojson",{lastModified:1})];
 try{
  await assert.rejects(uploadLayerRequest("test",metadata,files),/Conexión perdida/);
  assert.equal((await uploadLayerRequest("test",metadata,files)).id,"same-record");
  assert.equal(seen[0],seen[1]);
  await uploadLayerRequest("test",metadata,files);assert.notEqual(seen[1],seen[2]);
 }finally{globalThis.fetch=previousFetch;globalThis.window=previousWindow;}
});

test("reintento resuelve por usuario y clave, comprueba checksum/metadatos y rechaza conflicto",async()=>{
 const body={title:"A",division:"risk"},files=[{originalname:"a.kmz",size:10,checksum:"abc"}];
 const fingerprint=uploadFingerprint(body,files);const previous={id:"existing",metadata:{properties:{uploadFingerprint:fingerprint}}};
 const db={layer:{findFirst:async query=>{assert.equal(query.where.createdById,"actor");assert.equal(query.where.metadata.is.properties.equals,"request");return previous;}}};
 assert.equal(await findUploadRetry(db,"actor","request",fingerprint),previous);
 await assert.rejects(findUploadRetry(db,"actor","request",uploadFingerprint(body,[{...files[0],checksum:"different"}])),e=>e.statusCode===409);
 assert.equal(await findUploadRetry(db,"actor",null,fingerprint),null);
});
