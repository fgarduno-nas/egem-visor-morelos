import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
process.env.NODE_ENV ||= 'test';
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:55432/test';
process.env.JWT_SECRET ||= 'dummy-jwt-secret-for-local-tests';
process.env.DEFAULT_ADMIN_EMAIL ||= 'admin@example.test';
process.env.DEFAULT_ADMIN_PASSWORD ||= 'dummy-password';
process.env.DEFAULT_ADMIN_NAME ||= 'Admin Local';
const {app}=await import('../backend/src/app.js');
const {prisma}=await import('../backend/src/config/database.js');
const {signAccessToken}=await import('../backend/src/shared/utils/jwt.js');
const {mapLayer}=await import('../backend/src/modules/layers/layers.service.js');
const fixtures=[null,'hazard','vulnerability','risk'].map((division,index)=>({id:`division-${index}`,division,title:`Capa ${index}`,status:'published',isDeleted:false,createdById:'owner',metadata:{featureCount:1,geometryType:'Point',properties:{tags:division==='vulnerability'?[]:['category:geologicos'],isVisualizable:true,processingStatus:'processed',secret:'NEVER_EXPOSE',processedGeojsonPath:'NEVER_EXPOSE',geospatialDiagnostics:{secret:'NEVER_EXPOSE'}}},files:[],createdBy:{id:'owner',name:'Local',passwordHash:'NEVER_EXPOSE',role:{code:'ADMIN'}}}));
let server,base,original;
const token=signAccessToken({sub:'owner',role:'ADMIN'});
test.before(async()=>{original=prisma.layer.findMany;prisma.layer.findMany=async()=>fixtures;server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api/v1/layers`;});
test.after(async()=>{prisma.layer.findMany=original;await new Promise(r=>server.close(r));await prisma.$disconnect();});
test('classification DTO is explicit and safe for public, owner and administrator',()=>{
 for(const audience of ['public','owner','admin'])for(const fixture of fixtures){const dto=mapLayer(fixture,{audience});assert.equal(dto.divisionKey,fixture.division || "hazard");assert.equal(dto.phenomenon,fixture.division==='vulnerability'?null:'Geológicos');assert.equal(dto.phenomenonKey,fixture.division==='vulnerability'?null:'category:geologicos');assert.doesNotMatch(JSON.stringify(dto),/NEVER_EXPOSE|passwordHash|storagePath|geospatialDiagnostics|processedGeojsonPath/);}
});
test('public, own and administrative HTTP lists carry classification and historical hazard fallback',async()=>{
 for(const suffix of ['/public','/mine','/admin/manageable','/admin']){const response=await fetch(base+suffix,{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200);const {data}=await response.json();const items=Array.isArray(data)?data:data.items;assert.deepEqual(items.map(l=>l.divisionKey),['hazard','hazard','vulnerability','risk']);assert.equal(items[1].division,'Peligro');assert.doesNotMatch(JSON.stringify(data),/NEVER_EXPOSE/);}
});
test('administrative division filter paginates after filtering and rejects label as key',async()=>{
 for(const division of ['hazard','vulnerability','risk']){const response=await fetch(base+`/admin?division=${division}&pageSize=10`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200);const {data}=await response.json();assert.equal(data.pagination.totalItems,division==='hazard'?2:1);assert.equal(data.items[0].divisionKey,division);}
 assert.equal((await fetch(base+'/admin?division=Peligro',{headers:{Authorization:`Bearer ${token}`}})).status,400);
});
test('upload HTTP rejects missing or invalid division before persistence',async()=>{
 for(const division of [null,'other']){const data=new FormData();data.set('title','Prueba');data.set('tags','category:geologicos');if(division)data.set('division',division);const response=await fetch(base,{method:'POST',headers:{Authorization:`Bearer ${token}`,'X-EGEM-Classification-Version':'1'},body:data});assert.equal(response.status,400);const body=await response.json();assert.match(JSON.stringify(body),/secci[oó]n|Invalid enum/i);}
});

test('free tags before the phenomenon cannot erase the thematic division in any DTO',()=>{
 const fixture=structuredClone(fixtures[0]);fixture.metadata.properties.tags=['source:Morelos','category:geologicos','Riesgo'];
 for(const audience of ['public','owner','admin']) {
   const dto=mapLayer(fixture,{audience});assert.equal(dto.phenomenonKey,'category:geologicos');assert.equal(dto.divisionKey,'hazard');
 }
});
test('retired filter is rejected rather than exposing another division',async()=>{
 const response=await fetch(base+'/admin?division=unassigned',{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,400);
});
