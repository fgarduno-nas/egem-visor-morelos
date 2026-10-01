import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAdminLayerDetail} from '../js/app/utils/admin-layer-detail.js';
globalThis.window={__EGEM_CONFIG__:{},location:{hostname:'localhost'}};
const {buildLayerUploadFormData}=await import('../js/app/services/layers-api.js');
test('multipart payload transmits a single technical division and preserves phenomenon tags',()=>{
 const data=buildLayerUploadFormData({title:'Fixture',division:'risk',tags:['category:geologicos']},[]);
 assert.deepEqual(data.getAll('division'),['risk']);assert.deepEqual(data.getAll('tags'),['category:geologicos']);
 assert.equal(buildLayerUploadFormData({title:'Límite',division:null,tags:['category:limites']},[]).has('division'),false);
});

test('vulnerability multipart has a section but no phenomenon, category tag or invented value',()=>{
 const data=buildLayerUploadFormData({title:'Vulnerabilidad',division:'vulnerability',tags:[]},[]);
 assert.equal(data.get('division'),'vulnerability');
 for(const key of ['phenomenon','phenomenonKey','tags','category'])assert.equal(data.has(key),false);
 assert.doesNotMatch(JSON.stringify([...data]),/No aplica|category:/);
});
test('administrative detail shows classification while historical and reference cases remain distinct',()=>{
 const base={title:'Fixture',phenomenon:'Geológicos',phenomenonKey:'category:geologicos',divisionKey:'hazard'};
 assert.match(renderAdminLayerDetail(base),/Peligro → Geológicos/);
 assert.match(renderAdminLayerDetail({...base,divisionKey:null}),/Peligro → Geológicos/);
 const limits=renderAdminLayerDetail({...base,phenomenon:'Límites',phenomenonKey:'category:limites',divisionKey:null});
 assert.match(limits,/No aplica/);assert.doesNotMatch(limits,/Límites →/);
});

test('retired compatibility label and filter are absent from application sources', async()=>{
 const fs=await import('node:fs/promises');
 for(const file of ['index.html','js/map.js','js/app/utils/admin-layer-detail.js','shared/division-utils.js','backend/src/modules/layers/layers.schemas.js']) {
  const source=await fs.readFile(file,'utf8');
  assert.doesNotMatch(source,/Sin división asignada|unassigned/);
 }
});
