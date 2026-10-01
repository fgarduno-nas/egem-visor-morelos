import test from "node:test";
import assert from "node:assert/strict";
import { INSTITUTIONAL_DIVISIONS as divisions, normalizeDivisionKey, divisionLabel, divisionFields, effectiveDivisionKey, createDivisionFallbackReporter, divisionUploadError, groupLayersByDivision, isThematicPhenomenon } from "../shared/division-utils.js";
import { uploadLayerBodySchema, adminLayerListSchema } from "../backend/src/modules/layers/layers.schemas.js";

test("division catalog has exactly three immutable technical keys in institutional order", () => {
  assert.deepEqual(divisions.map(d => d.key), ["hazard", "vulnerability", "risk"]);
  assert.deepEqual(divisions.map(d => d.label), ["Peligro", "Vulnerabilidad", "Riesgo"]);
  assert.ok(Object.isFrozen(divisions)); assert.ok(divisions.every(Object.isFrozen));
});
for (const {key, label} of divisions) test(`division ${key} is distinct from label ${label}`, () => {
  assert.equal(normalizeDivisionKey(key), key); assert.equal(divisionLabel(key), label);
  assert.equal(normalizeDivisionKey(label), null); assert.equal(normalizeDivisionKey(key.toUpperCase()), null);
  assert.deepEqual(divisionFields(key, key === "vulnerability" ? null : "geologicos"), {divisionKey:key, division:label});
});
test("invalid read values fall back to hazard only for explicit thematic phenomena", () => {
  for (const value of [null, undefined, "", "exposure", "danger", ["hazard"], {}, "Riesgo geológico"])
    {
      assert.deepEqual(divisionFields(value, "geologicos"), {divisionKey:"hazard", division:"Peligro"});
      assert.deepEqual(divisionFields(value, "limites"), {divisionKey:null, division:null});
      assert.deepEqual(divisionFields(value, "otras"), {divisionKey:null, division:null});
    }
});
for (const category of ["geologicos", "hidrometeorologicos", "quimicos-tecnologicos", "sanitario-ecologico", "socio-organizativo", "astronomicos"]) {
  test(`${category} requires exactly one technical division on upload`, () => {
    const base = {title:"Capa local", tags:[`category:${category}`]};
    assert.ok(isThematicPhenomenon(category)); assert.ok(divisionUploadError(category, null));
    assert.equal(uploadLayerBodySchema.safeParse(base).success, false);
    for (const division of ["hazard", "vulnerability", "risk"]) assert.equal(uploadLayerBodySchema.safeParse({...base,division}).success, division === "hazard" || division === "risk" && ["geologicos","hidrometeorologicos","quimicos-tecnologicos"].includes(category));
    for (const division of ["Peligro", "HAZARD", "other", ["hazard","risk"]]) assert.equal(uploadLayerBodySchema.safeParse({...base,division}).success, false);
  });
}
test("references and Limits accept absence but reject institutional divisions", () => {
  for (const category of ["limites", "otras"]) {
    assert.equal(isThematicPhenomenon(category), false);
    assert.equal(uploadLayerBodySchema.safeParse({title:"Referencia", tags:[`category:${category}`]}).success,true);
    assert.equal(uploadLayerBodySchema.safeParse({title:"Referencia", tags:[`category:${category}`],division:"risk"}).success,false);
  }
});
test("multipart bracket tags cannot bypass mandatory division", () => {
  assert.equal(uploadLayerBodySchema.safeParse({title:"Capa", "tags[]":"category:geologicos"}).success,false);
});
test("grouping keeps exactly three divisions and assigns historical thematic reads to hazard", () => {
  const layers = [{id:"1",divisionKey:"risk"},{id:"2",title:"Peligro",divisionKey:null},{id:"3",divisionKey:"hazard"}];
  const before=JSON.stringify(layers), groups=groupLayersByDivision(layers);
  assert.deepEqual(groups.map(g=>g.key),["hazard","vulnerability","risk"]);
  assert.deepEqual(groups.map(g=>g.layers.length),[2,0,1]);
  assert.equal(groups[0].layers[0].id,"2");
  assert.equal(new Set(groups.flatMap(g=>g.layers.map(l=>l.id))).size,layers.length);
  assert.equal(JSON.stringify(layers),before);
  assert.equal(groupLayersByDivision([]).length,3);
});
test("admin filter accepts only the three technical keys", () => {
  for(const division of ["", "hazard","vulnerability","risk"]) assert.equal(adminLayerListSchema.parse({query:{division}}).query.division,division);
  assert.equal(adminLayerListSchema.safeParse({query:{division:"Peligro"}}).success,false);
});

test("new uploads cannot evade thematic classification with unknown or conflicting categories", () => {
  for (const tags of [[], ["category:inventada"], ["category:limites", "category:geologicos"]])
    assert.equal(uploadLayerBodySchema.safeParse({title:"Capa nueva", tags}).success, false);
});

test("defensive fallback emits only one aggregate warning per viewer session", () => {
  const warnings=[]; const report=createDivisionFallbackReporter(message=>warnings.push(message));
  report(0); report(23); report(1); report(23);
  assert.equal(warnings.length,1); assert.match(warnings[0],/23 capas temáticas/);
});
for(const phenomenon of ["geologicos","hidrometeorologicos","quimicos-tecnologicos","sanitario-ecologico","socio-organizativo","astronomicos"]) {
  test(`${phenomenon} historical and incompatible reads respect the section matrix`,()=>{
    assert.equal(effectiveDivisionKey(null,phenomenon),"hazard");
    assert.equal(effectiveDivisionKey("hazard",phenomenon),"hazard");
    assert.equal(effectiveDivisionKey("vulnerability",phenomenon),"hazard");
    assert.equal(effectiveDivisionKey("risk",phenomenon),["geologicos","hidrometeorologicos","quimicos-tecnologicos"].includes(phenomenon)?"risk":"hazard");
    assert.deepEqual(groupLayersByDivision([{id:"old",divisionKey:null}]).map(g=>g.key),["hazard","vulnerability","risk"]);
  });
}
