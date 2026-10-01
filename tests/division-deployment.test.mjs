import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {classificationContractController,requireClassificationContract} from '../backend/src/modules/layers/classification-contract.js';
globalThis.window={__EGEM_CONFIG__:{},location:{hostname:'localhost'}};
const {uploadLayerRequest}=await import('../js/app/services/layers-api.js');

function response() {
 return {code:200,headers:{},set(k,v){this.headers[k]=v;return this},status(v){this.code=v;return this},json(v){this.body=v;return this}};
}
test('final contract is uncached and advertised without authentication or DB data',()=>{
 const res=response();classificationContractController({},res);
 assert.equal(res.headers['Cache-Control'],'no-store');assert.deepEqual(res.body,{success:true,data:{version:1}});
});
test('cached previous frontend receives an explicit reload instruction before multipart parsing',async()=>{
 const res=response();let next=false;requireClassificationContract({get:()=>undefined},res,()=>next=true);
 assert.equal(res.code,409);assert.match(res.body.message,/Recarga/);assert.equal(next,false);
 const route=await fs.readFile('backend/src/modules/layers/layers.routes.js','utf8');
 const post=route.slice(route.indexOf('layersRouter.post('));assert.ok(post.indexOf('requireClassificationContract')<post.indexOf('upload.array'));
});
test('current frontend is allowed to reach strict upload validation',()=>{
 let called=false;requireClassificationContract({get:()=> '1'},response(),()=>called=true);assert.equal(called,true);
});
test('bridge release pauses all uploads with an explicit message but requires no Prisma changes',async()=>{
 const source=(await fs.readFile('backend/src/modules/layers/classification-contract.js','utf8')).replace('CLASSIFICATION_CONTRACT_VERSION = 1','CLASSIFICATION_CONTRACT_VERSION = 0');
 const bridge=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 for(const header of [undefined,'0','1']){const res=response();bridge.requireClassificationContract({get:()=>header},res,()=>assert.fail('bridge must pause upload'));assert.equal(res.code,503);assert.match(res.body.message,/consulta sigue disponible/);}
 const res=response();bridge.classificationContractController({},res);assert.equal(res.body.data.version,0);
});
for(const version of [0,2,null,'1'])test(`new frontend sends no file to unsupported contract ${version}`,async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push(options.method);return new Response(JSON.stringify({data:{version}}),{status:200});};
 try{await assert.rejects(uploadLayerRequest('synthetic',{title:'Fixture',division:'vulnerability'},[]),/No se envió ningún archivo/);assert.deepEqual(calls,['GET']);}finally{globalThis.fetch=original;}
});
test('new frontend against previous backend 404 aborts before POST',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push(options.method);return new Response('{}',{status:404});};
 try{await assert.rejects(uploadLayerRequest('synthetic',{title:'Fixture'},[]),/No se envió ningún archivo/);assert.deepEqual(calls,['GET']);}finally{globalThis.fetch=original;}
});
test('new frontend against final backend sends the validated contract marker',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push(options);return new Response(JSON.stringify({data:options.method==='GET'?{version:1}:{id:'created'}}),{status:200});};
 try{assert.equal((await uploadLayerRequest('synthetic',{title:'Fixture',division:'vulnerability',tags:[]},[])).id,'created');assert.equal(calls[1].headers['X-EGEM-Classification-Version'],'1');assert.equal(calls[1].body.get('division'),'vulnerability');assert.equal(calls[1].body.has('tags'),false);}finally{globalThis.fetch=original;}
});
