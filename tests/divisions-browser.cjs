const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs');
const root=process.env.DIVISION_REVIEW_DIR;
const base=process.env.DIVISION_REVIEW_URL;
const email=process.env.DIVISION_TEST_EMAIL, password=process.env.DIVISION_TEST_PASSWORD;
assert.ok(root && base && email && password, 'Se requieren URL local, directorio de evidencia y credenciales sintéticas de prueba');
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname), 'Esta prueba solo admite un servidor local de fixtures');
fs.mkdirSync(root,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge'});const results=[],errors=[];try{
for(const [width,height] of [[1920,1080],[1366,768],[390,844]]) {
 const p=await browser.newPage({viewport:{width,height}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await p.route('**/js/map.js*',async r=>{const res=await r.fetch();await r.fulfill({response:res,body:await res.text()+'\nwindow.qa={map,state,staticLayers,toggleLayerVisibility,captureThematicExportSnapshot,setCloudTopVisibility,applyBaseMapVisibility,openUploadModal,loadAdminLayerTable,renderSession,renderLayerCatalog};'})});
 await p.goto(base);await p.locator('#accept-trial-notice').click();await p.waitForFunction(()=>window.qa?.state.userLayers.length>=8);
 assert.deepEqual(await p.locator('[data-section]').evaluateAll(es=>es.map(e=>e.dataset.section)),['hazard','vulnerability','risk']);
 assert.equal(await p.locator('[data-section=hazard] .layer-group').count(),6);
 assert.equal(await p.locator('[data-section=risk] .layer-group').count(),3);
 assert.equal(await p.locator('[data-section=vulnerability] .layer-group').count(),0);
 assert.equal(await p.locator('[data-section=vulnerability] .layer-item').count(),2);
 assert.doesNotMatch(await p.locator('[data-section=risk]').innerText(),/Astronómicos|Sanitario|Socio/);
 assert.doesNotMatch(await p.locator('body').innerText(),/Sin división asignada/);
 assert.equal(await p.locator('.layer-item').filter({hasText:'Histórica geológica sin clasificación'}).evaluate(e=>e.closest('[data-section]').dataset.section),'hazard');
 const titles=await p.locator('.layer-item').evaluateAll(es=>es.map(e=>e.dataset.layerId));assert.equal(new Set(titles).size,titles.length);
 await p.screenshot({path:root+`/sidebar-${width}.png`});
 await p.locator('#layer-search').fill('Vulnerabilidad A');await p.waitForTimeout(150);
 assert.equal(await p.locator('.layer-item').count(),1);assert.equal(await p.locator('.layer-item').evaluate(e=>e.closest('[data-section]').dataset.section),'vulnerability');
 await p.locator('#layer-search').fill('');
 const ids=await p.evaluate(()=>Object.fromEntries(qa.state.userLayers.map(l=>[l.title,l.id])));
 for(const name of ['Geológica de prueba: peligro','Riesgo geológico','Límite de prueba','Referencia cartográfica de prueba'])await p.evaluate(id=>qa.toggleLayerVisibility(id,true),ids[name]);
 assert.deepEqual((await p.evaluate(()=>qa.state.userLayers.filter(l=>l.visible).map(l=>l.title))).sort(),['Riesgo geológico','Límite de prueba','Referencia cartográfica de prueba'].sort());
 await p.reload();await p.locator('#accept-trial-notice').click();await p.waitForFunction(()=>window.qa?.state.userLayers.filter(l=>l.visible).length===3);assert.equal(await p.evaluate(()=>qa.state.userLayers.find(l=>l.visible&&l.category==='geologicos').divisionKey),'risk');
 // Log in through the real form, with synthetic local-only account.
 await p.evaluate(()=>document.querySelector('#login-modal').showModal());await p.locator('#login-email').fill(email);await p.locator('#login-password').fill(password);await p.locator('#login-form button[type=submit]').click();
 await p.waitForFunction(()=>qa.state.session.role==='admin');await p.evaluate(()=>qa.openUploadModal());
 const select=p.locator('#upload-layer-division');assert.equal(await select.getAttribute('required'),'');assert.equal(await select.locator('option').count(),4);
 const category=p.locator('#upload-layer-category');
 for(const invalid of ['astronomicos','sanitario-ecologico','socio-organizativos']) {
   await select.selectOption('hazard');assert.equal(await category.locator('option').count(),7);
   await category.selectOption(invalid);await select.selectOption('risk');
   assert.equal(await category.inputValue(),'');assert.equal(await category.locator('option').count(),4);
 }
 await category.selectOption('geologicos');await select.selectOption('vulnerability');
 assert.equal(await category.isVisible(),false);assert.equal(await category.inputValue(),'');assert.equal(await p.evaluate(()=>qa.state.uploadDraft.category),'');
 await p.screenshot({path:root+`/upload-vulnerability-${width}.png`});
 await p.locator('#upload-layer-kind').selectOption('limites');assert.equal(await select.isVisible(),false);assert.equal(await category.isVisible(),false);
 await p.locator('#upload-layer-kind').selectOption('thematic');await select.selectOption('hazard');await category.selectOption('astronomicos');
 await p.locator('#upload-draft-input').setInputFiles({name:'vista-previa.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{name:'Vista previa'},geometry:{type:'Point',coordinates:[-99.1,18.8]}}]}))});
 await p.waitForFunction(()=>qa.state.uploadDraft.previewVisible);
 assert.equal(await select.inputValue(),'hazard');assert.equal(await p.evaluate(()=>qa.state.uploadDraft.previewLayers[0].divisionKey),'hazard');
 await select.focus();await p.keyboard.press('ArrowDown');assert.equal(await select.inputValue(),'vulnerability');await select.selectOption('hazard');await category.selectOption('geologicos');
 await p.screenshot({path:root+`/upload-${width}.png`});await p.evaluate(()=>document.querySelector('#upload-layer-modal').close());
 await p.evaluate(async()=>{document.querySelector('#user-admin-modal').showModal();await qa.loadAdminLayerTable();});assert.deepEqual(await p.locator('#admin-layer-division option').evaluateAll(es=>es.map(e=>e.value)),['','hazard','vulnerability','risk']);await p.locator('#admin-layer-division').scrollIntoViewIfNeeded();
 await p.screenshot({path:root+`/admin-${width}.png`});await p.locator('#admin-layer-division').selectOption('risk');await p.waitForFunction(()=>qa.state.adminLayerTable.items.length===3);
 assert.match(await p.locator('#admin-layer-table-body').innerText(),/Riesgo/);await p.locator('[data-admin-layer-details]').first().click();await p.locator('#admin-layer-details').scrollIntoViewIfNeeded();await p.screenshot({path:root+`/detail-${width}.png`});
 assert.match(await p.locator('#admin-layer-details').innerText(),/Riesgo →/);
 await p.locator('[data-admin-layer-return]').click();
 await p.locator('#admin-layer-division').selectOption('vulnerability');await p.waitForFunction(()=>qa.state.adminLayerTable.items.length===2);
 assert.equal(await p.locator('#admin-layer-phenomenon').isDisabled(),true);assert.equal(await p.locator('#admin-layer-phenomenon').inputValue(),'');
 await p.locator('[data-admin-layer-details]').first().click();assert.match(await p.locator('#admin-layer-details').innerText(),/No aplica/);
 await p.locator('#admin-layer-details').scrollIntoViewIfNeeded();await p.screenshot({path:root+`/detail-vulnerability-${width}.png`});

 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 results.push({width,height,hierarchy:true,search:true,reload:true,exclusiveWithReference:true,upload:true,admin:true,detail:true,overflow:false});await p.close();console.log('PASS',width);
}assert.deepEqual(errors,[]);fs.writeFileSync(root+'/browser-results.json',JSON.stringify({results,errors},null,2));}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
