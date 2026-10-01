import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {writeFixtureAsset} from './support/division-fixture-asset.mjs';
const originalCwd=process.cwd();
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'egem-asset-test-'));
process.chdir(directory);
Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:'postgres://unused:unused@127.0.0.1:55432/test',JWT_SECRET:'synthetic-asset-test-secret',DEFAULT_ADMIN_EMAIL:'fixture@example.test',DEFAULT_ADMIN_PASSWORD:'synthetic-only-password',DEFAULT_ADMIN_NAME:'Fixture',UPLOAD_BASE_DIR:'uploads'});
const {app}=await import('../backend/src/app.js');
const {prisma}=await import('../backend/src/config/database.js');
const {env}=await import('../backend/src/config/env.js');
const {mapLayer}=await import('../backend/src/modules/layers/layers.service.js');
const originalFind=prisma.layer.findMany;
let server,base,asset,record;
const origin='http://127.0.0.1:54321';
test.before(async()=>{
 server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;env.PUBLIC_BASE_URL=base;
 asset=await writeFixtureAsset(directory,base,'synthetic-geological');
 record={id:'synthetic-geological',division:'hazard',title:'Synthetic geological',status:'published',isDeleted:false,files:[{...asset,originalName:'fixture.geojson',extension:'geojson',mimeType:'application/geo+json'}],metadata:{featureCount:1,geometryType:'Point',properties:{tags:['category:geologicos'],isVisualizable:true,processingStatus:'processed',processedGeojsonPath:asset.storagePath,processedGeojsonUrl:asset.publicUrl}}};
 prisma.layer.findMany=async()=>[record];
});
test.after(async()=>{prisma.layer.findMany=originalFind;server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await prisma.$disconnect();process.chdir(originalCwd);await fs.rm(directory,{recursive:true,force:true});await assert.rejects(fs.stat(directory));});
test('fixture DTO and disk use the production processed asset contract',async()=>{
 const dto=mapLayer(record,{audience:'public'});assert.equal(dto.processedGeojsonUrl,`${base}/uploads/processed/synthetic-geological/layer.geojson`);assert.equal(dto.processedGeojsonUrl,dto.files[0].publicUrl);assert.ok((await fs.stat(asset.storagePath)).size>0);
});
test('fixture downloads over real HTTP with production MIME, CORS and valid Morelos GeoJSON',async()=>{
 const response=await fetch(asset.publicUrl,{headers:{Origin:origin}});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/(geo\+json|json|vnd.geo\+json)/);assert.equal(response.headers.get('access-control-allow-origin'),origin);
 const value=await response.json();assert.equal(value.type,'FeatureCollection');assert.equal(value.features.length,1);assert.equal(value.features[0].geometry.type,'Point');assert.deepEqual(value.features[0].geometry.coordinates,[-99.1,18.8]);assert.equal(value.features[0].properties.category,'geologicos');
});
test('fixture cleanup removes the real asset and middleware returns 404 afterwards',async()=>{
 await fs.unlink(asset.storagePath);await assert.rejects(fs.stat(asset.storagePath),{code:'ENOENT'});assert.equal((await fetch(asset.publicUrl)).status,404);
});
