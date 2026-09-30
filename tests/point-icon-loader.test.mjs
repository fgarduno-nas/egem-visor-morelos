import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { waitForExportResource, encodePng } from "../js/app/utils/map-export.js";

test("PNG encoding preserves the result and bounds a missing callback", async () => {
  const blob = new Blob(["png"], { type: "image/png" });
  assert.equal(await encodePng({ toBlob(callback, type) { assert.equal(type, "image/png"); callback(blob); } }), blob);
  await assert.rejects(encodePng({ toBlob() {} }, 5), /codificación PNG/);
  await assert.rejects(encodePng({ toBlob(callback) { callback(null); } }), /codificar/);
});

const source = fs.readFileSync(new URL("../js/map.js", import.meta.url), "utf8");
import { createPointIconLoader, canonicalPointSymbol, decodePointIcon } from "../js/app/utils/point-icon-resource.js";
import { prepareExportResources } from "../js/app/utils/map-export.js";
import { getEventListeners } from "node:events";
const image = { width: 1, height: 1, data: new Uint8Array([1,2,3,255]) };
const response = { ok: true, blob: async () => new Blob(["png"]) };

test("immediate PNG is decoded once and concurrent/subsequent consumers share pixels", async () => {
  let requests=0,decodes=0;
  const load=createPointIconLoader({fetchImage:async()=>{requests++;return response},decode:async()=>{decodes++;return image}});
  const [a,b]=await Promise.all([load('icon.png'),load('icon.png')]);
  assert.equal(a,image);assert.equal(b,image);assert.equal(await load('icon.png'),image);
  assert.equal(requests,1);assert.equal(decodes,1);
});

test("real HTTP failures preserve URL and stage; no invalid pixels cached", async () => {
  let requests=0;const load=createPointIconLoader({fetchImage:async()=>{requests++;return{ok:false,status:503}},decode:async()=>image});
  for(let i=0;i<2;i++)await assert.rejects(load('icon.png'),e=>e.stage==='http'&&/HTTP 503.*icon.png/.test(e.message));
  assert.equal(requests,2);
});

test("decode error is distinguished from HTTP failure", async () => {
  const load=createPointIconLoader({fetchImage:async()=>response,decode:async()=>{throw new Error('invalid image')}});
  await assert.rejects(load('broken.png'),e=>e.stage==='decode'&&e.message==='invalid image');
});

test("timeout aborts HTTP, consumes late response and leaves no timer or listener", async () => {
  let finish,networkSignal;const timers=new Set(),controller=new AbortController();let decoded=0;
  const load=createPointIconLoader({timeoutMs:5,fetchImage:(_,o)=>{networkSignal=o.signal;return new Promise(r=>finish=r)},decode:async()=>{decoded++;return image},
    schedule:(fn,ms)=>{const t=setTimeout(fn,ms);timers.add(t);return t},unschedule:t=>{timers.delete(t);clearTimeout(t)}});
  await assert.rejects(load('late.png',{signal:controller.signal}),e=>e.stage==='http');
  assert.ok(networkSignal.aborted);assert.equal(timers.size,0);assert.equal(getEventListeners(controller.signal,'abort').length,0);
  finish(response);await new Promise(r=>setTimeout(r,0));assert.equal(decoded,0);
});

test("hung decoder is bounded; late decode cannot replace a settled result", async () => {
  let finish;const load=createPointIconLoader({timeoutMs:5,fetchImage:async()=>response,decode:()=>new Promise(r=>finish=r)});
  await assert.rejects(load('late-decode.png'),e=>e.stage==='decode');finish(image);await new Promise(r=>setTimeout(r,0));
});

test("late ImageBitmap closes after cancellation even when it cannot be interrupted", async () => {
  const old=globalThis.createImageBitmap;let finish,closed=0;globalThis.createImageBitmap=()=>new Promise(r=>finish=r);
  const controller=new AbortController();try{const p=decodePointIcon(new Blob(),controller.signal);controller.abort();finish({close(){closed++}});await assert.rejects(p,{name:'AbortError'});assert.equal(closed,1)}finally{globalThis.createImageBitmap=old}
});

test("one cancelled consumer does not cancel another; last consumer releases network", async () => {
  const a=new AbortController(),b=new AbortController();let done,signal;
  const load=createPointIconLoader({fetchImage:(_,o)=>{signal=o.signal;return new Promise(r=>done=r)},decode:async()=>image});
  const first=load('icon',{signal:a.signal}),second=load('icon',{signal:b.signal});a.abort();await assert.rejects(first,{name:'AbortError'});assert.equal(signal.aborted,false);
  done(response);assert.equal(await second,image);assert.equal(getEventListeners(b.signal,'abort').length,0);
  const c=new AbortController();const p=load('other',{signal:c.signal});c.abort();await assert.rejects(p,{name:'AbortError'});assert.ok(signal.aborted);
});

test("canonical shape and color precedence never change class identity",()=>{
  const item={geometryRole:'manantial',displayColor:'#112233',originalColor:'#445566',color:'#778899',label:'Personalizado'};const before=structuredClone(item);
  assert.deepEqual(canonicalPointSymbol(item),{shape:'dot',color:'#112233'});
  assert.deepEqual(canonicalPointSymbol({...item,geometryRole:'pozo',displayColor:null}),{shape:'triangle',color:'#445566'});
  assert.equal(canonicalPointSymbol({...item,displayColor:null,originalColor:null}).color,'#778899');
  assert.equal(canonicalPointSymbol({geometryRole:'pozo'}).color,'#7a203a');assert.equal(canonicalPointSymbol({label:'Unknown'}),null);assert.deepEqual(item,before);assert.equal(canonicalPointSymbol({...item,displayColor:'#abc'}).color,'#aabbcc');
});

const pointLoaderSource=source.slice(source.indexOf('  async function loadPointIconImage('),source.indexOf('  function getLayerPointIcons('));
function integratedLoader({remote=async()=>image,fallback=()=>image,item={geometryRole:'manantial',styleUrl:'#spring',displayColor:'#112233'}}={}){
  const images=new Map();const map={hasImage:id=>images.has(id),addImage:(id,pixels)=>images.set(id,pixels)};
  const load=new Function('map','buildPointIconImageId','getPointIconImageUrl','loadMapImage','POINT_ICON_LOAD_TIMEOUT_MS','getVectorLayerSymbology','canonicalPointSymbol','createFallbackPointIcon',pointLoaderSource+';return loadPointIconImage;')(map,()=> 'symbol',async()=> 'icon.png',remote,6500,()=>({classes:[item]}),canonicalPointSymbol,fallback);
  return{load,images};
}
test("remote timeout recovers canonical symbol once; next export uses registry",async()=>{
  let requests=0,builds=0;const{load,images}=integratedLoader({remote:async()=>{requests++;throw new Error('timeout')},fallback:(shape,color)=>{builds++;assert.equal(shape,'dot');assert.equal(color,'#112233');return image}});
  const icon={styleUrl:'#spring'};assert.equal((await load({},icon)).route,'canonical-local');assert.equal((await load({},icon)).route,'map-registry');assert.equal(requests,1);assert.equal(builds,1);assert.equal(images.size,1);
});
test("unknown class or failed canonical fallback stays an export-blocking failure",async()=>{
  const remote=async()=>{throw new Error('HTTP 503')};
  await assert.rejects(integratedLoader({remote,item:{styleUrl:'#spring',label:'Unknown'}}).load({},{styleUrl:'#spring'}),/503/);
  await assert.rejects(integratedLoader({remote,fallback:()=>{throw new Error('canvas failed')}}).load({},{styleUrl:'#spring'}),AggregateError);
});
test("rapid layer replacement never registers a late icon or a cancelled fallback",async()=>{
  let done;const controller=new AbortController();const{load,images}=integratedLoader({remote:()=>new Promise(r=>done=r)});
  const p=load({__activation:{signal:controller.signal}},{styleUrl:'#spring'});await Promise.resolve();controller.abort();done(image);await assert.rejects(p,{name:'AbortError'});assert.equal(images.size,0);
});
test("export preparation waits for first activation and bounds an unresolved layer",async()=>{
  let finish,ready=false;const controller=new AbortController();const p=prepareExportResources(()=>new Promise(r=>finish=()=>{ready=true;r()}),controller,100);
  await Promise.resolve();assert.equal(ready,false);finish();await p;assert.equal(ready,true);
  await assert.rejects(prepareExportResources(()=>new Promise(()=>{}),new AbortController(),5),/No se generó el PNG/);
});
test("cancelled preparation removes its listener even if the resource never settles",async()=>{
  const c=new AbortController();const p=waitForExportResource(new Promise(()=>{}),c.signal);c.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(getEventListeners(c.signal,'abort').length,0);
});

test("export preparation can be cancelled even when its pending resource never resolves", async () => {
  const controller = new AbortController();
  const pending = waitForExportResource(new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("an already cancelled export consumes a concurrent resource failure", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(waitForExportResource(Promise.reject(new Error("resource failed")), controller.signal), { name: "AbortError" });
});

test("successful shared loads clear deadlines and subscriber listeners",async()=>{
  const timers=new Set(),controller=new AbortController();const load=createPointIconLoader({fetchImage:async()=>response,decode:async()=>image,
    schedule:(fn,ms)=>{const t=setTimeout(fn,ms);timers.add(t);return t},unschedule:t=>{timers.delete(t);clearTimeout(t)}});
  await load('ready',{signal:controller.signal});assert.equal(timers.size,0);assert.equal(getEventListeners(controller.signal,'abort').length,0);
});
test("PNG body stalls are bounded separately from decoding",async()=>{
  const load=createPointIconLoader({timeoutMs:5,fetchImage:async()=>({ok:true,blob:()=>new Promise(()=>{})}),decode:async()=>{assert.fail('decode must not run')}});
  await assert.rejects(load('body.png'),e=>e.stage==='body');
});

test("a point without a canonical class does not invent a recolored class or dereference null",()=>{
  const fn=source.slice(source.indexOf('  function applyPointIconFeatureIds('),source.indexOf('  function applyPointFallbackIconFeatureIds('));
  const apply=new Function('getVectorLayerSymbology','getFeatureLegendClass','normalizeHexColor','getDraftLegendPointIconImageId','getFallbackPointIconImageId',fn+';return applyPointIconFeatureIds;')(()=>null,()=>null,(_,fallback)=>fallback,()=>assert.fail('missing class must not be recolored'),()=>null);
  const layer={data:{features:[{geometry:{type:'Point'},properties:{Name:'Unclassified'}}]}};
  apply(layer);assert.deepEqual(layer.data.features[0].properties,{Name:'Unclassified'});
});
