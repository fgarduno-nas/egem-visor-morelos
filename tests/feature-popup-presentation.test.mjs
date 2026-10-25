import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('js/map.js', 'utf8');
function extract(name) {
  const start=source.indexOf(`  function ${name}(`);
  assert.notEqual(start,-1,name);
  const candidates=[source.indexOf('\n  function ',start+1),source.indexOf('\n  const ',start+1)].filter(n=>n>=0);
  return source.slice(start,Math.min(...candidates));
}
const ctx=vm.createContext({});
vm.runInContext(['cleanFeatureAttributes','getPopupAttributeSchema','normalizeAttributeKey','isUsablePopupValue','getPropertyValueByAlias','cleanThematicPopupAttributes','buildFeaturePopup','buildThematicFeaturePopup','getThematicPopupTitle','buildGroundOverlayPopup','escapeHtml','hasPopupProperties'].map(extract).join('\n')+'\nfunction parseKmlDescriptionHtmlAttributes() { return {}; }',ctx);
test('todas las variantes comprobadas conservan cero y solo dos campos',()=>{
  for(const alias of ['Intensidad','INTENSIDAD','inténsidad','Intensid_1','Intensidad_1','Intensid1']) {
    const props={[alias]:0,DETÁLLES:'Detalle real',id:123,__styleFill:'#f00'};
    const before=JSON.stringify(props);
    const result=ctx.cleanFeatureAttributes(props);
    assert.deepEqual(Object.keys(result),['Intensidad','Detalles']);
    assert.equal(result.Intensidad,'0');assert.equal(result.Detalles,'Detalle real');
    assert.equal(JSON.stringify(props),before);
  }
});
test('campos ausentes, vacios y categorias de puntos no aportan equivalencias',()=>{
  for(const props of [{},{Intensidad:null,Detalles:' '},{Intensidad:'',Detalles:undefined},{Riesgo:'Alto',Nivel:2,Descripcion:'Otro campo',Magni_uni:'Alto'},{Name:'Pozo',__geometryRole:'pozo',nom_geo:'Localidad'}]) {
    const result=ctx.cleanThematicPopupAttributes(props,{classes:[{label:'Muy alto'}]},{label:'Muy alto'});
    assert.equal(result.Intensidad,'Sin información');assert.equal(result.Detalles,'Sin información');
    assert.deepEqual(Object.keys(result),['Intensidad','Detalles']);
  }
  assert.equal(ctx.hasPopupProperties({}),true);
});
test('recuadros comunes conservan titulo, escapan HTML y no duplican atributos',()=>{
  const props={Intensidad:0,Detalles:'<img src=x onerror=alert(1)>',id:123};
  const thematic=ctx.buildThematicFeaturePopup('<script>Capa</script>',props);
  const common=ctx.buildFeaturePopup('<script>Capa</script>',props);
  assert.equal(thematic,common);
  assert.equal((common.match(/<dt>/g)||[]).length,2);
  assert.ok(common.includes('&lt;img'));assert.ok(common.includes('&lt;script&gt;'));
  assert.ok(!common.includes('<img'));assert.ok(!common.includes('<script>'));
  assert.ok(!common.includes('feature-popup__highlight'));
});
test('raster muestra ausencia de atributos sin convertir metadatos',()=>{
 const html=ctx.buildGroundOverlayPopup({title:'Raster real',description:'No es Detalles',metadata:{properties:{source:'Fuente'}}});
 assert.equal((html.match(/Sin información/g)||[]).length,2);
 assert.equal((html.match(/<dt>/g)||[]).length,2);
 assert.ok(!html.includes('No es Detalles'));
});
