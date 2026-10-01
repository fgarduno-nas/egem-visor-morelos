import test from 'node:test';
import assert from 'node:assert/strict';
import {INSTITUTIONAL_DIVISIONS, phenomenaForDivision, reconcileDivisionPhenomenon, classificationFields, divisionUploadError} from '../shared/division-utils.js';
import {uploadLayerBodySchema,adminLayerListSchema} from '../backend/src/modules/layers/layers.schemas.js';

const categories=['geologicos','hidrometeorologicos','quimico-tecnologicos','sanitario-ecologico','socio-organizativos','astronomicos'];
for(const [section,count] of [['hazard',6],['vulnerability',0],['risk',3]]) test(`${section} has exactly ${count} ordered phenomena`,()=>{
 assert.deepEqual(phenomenaForDivision(section).map(p=>p.key),categories.slice(0,count).map(p=>'category:'+p));
});
for(const [i,phenomenon] of [...categories,null,'unknown'].entries()) for(const division of INSTITUTIONAL_DIVISIONS.map(d=>d.key)) {
 test(`${division}/${phenomenon}: API and shared validation agree`,()=>{
  const valid=division==='vulnerability'?phenomenon===null:i<(division==='hazard'?6:3);
  const tags=phenomenon?['category:'+phenomenon]:[];
  assert.equal(uploadLayerBodySchema.safeParse({title:'Fixture',division,tags}).success,valid);
  assert.equal(divisionUploadError(phenomenon,division)===null,valid);
  if(phenomenon) assert.equal(adminLayerListSchema.safeParse({query:{division,phenomenon}}).success,valid);
 });
}
for(const prior of categories) test(`changing ${prior} to vulnerability clears all phenomenon state`,()=>{
 assert.equal(reconcileDivisionPhenomenon('vulnerability',prior),'');
 assert.equal(reconcileDivisionPhenomenon('risk',prior),categories.slice(0,3).includes(prior)?prior:'');
});
test('vulnerability DTO has no invented phenomenon or reference',()=>{
 assert.deepEqual(classificationFields('vulnerability',null),{divisionKey:'vulnerability',division:'Vulnerabilidad',phenomenonKey:null,phenomenon:null,referenceCategory:null});
});
test('vulnerability rejects hidden explicit fields even without category tags',()=>{
 for(const key of ['phenomenon','phenomenonKey']) assert.equal(uploadLayerBodySchema.safeParse({title:'Fixture',division:'vulnerability',[key]:'geologicos'}).success,false);
});
