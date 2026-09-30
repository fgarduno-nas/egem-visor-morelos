const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = path.resolve(process.env.EXPORT_REVIEW_DIR || path.join(require('node:os').tmpdir(), 'egem-export-format-review'));
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 760 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.route('**/js/map.js*', async route => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()) + '\nwindow.qa={map,state,setCloudTopVisibility,applyBaseMapVisibility};' });
  });
  await page.route('**/js/app/utils/map-export.js', async route => {
    const res = await route.fetch();
    const body = (await res.text())
      .replace('context.scale(2, 2);', 'window.qaRaw = output.toDataURL(); context.scale(2, 2);')
      .replace('finish(null, output);', `window.qaExport = {center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch(),orientation:snapshot,thematic,width,height,crop,
        horizontal:[map.unproject([0,height/2]).toArray(),map.unproject([width,height/2]).toArray()],scale,
        scaleMeters:map.unproject([width/2-scale.pixels/ratio,centerY]).distanceTo(map.unproject([width/2+scale.pixels/ratio,centerY])),
        frozenUrl:qa.state.cloudTop.mapLayer && qa.map.getStyle().sources[qa.state.cloudTop.mapLayer.getSourceId(qa.state.cloudTop.mapLayer.activeBuffer)]?.url,
        roads:map.getStyle().sources['vialidades-nivel-3-source']?.data?.features?.length,
        imageIds:map.listImages(),layers:map.getStyle().layers.map(l=>l.id),
        addedPoint:map.queryRenderedFeatures({layers:map.getLayer('qa-extra')?['qa-extra']:[]}).length,
        goes:Object.entries(map.getStyle().sources).filter(([id])=>id.startsWith('cloud-top-animation-source')).map(([id,s])=>({id,url:s.url}))}; finish(null, output);`);
    await route.fulfill({ response: res, body });
  });
  await page.addInitScript(() => { window.showSaveFilePicker=undefined; });
  await page.goto(process.env.EXPORT_BASE_URL || 'http://127.0.0.1:4192');
  await page.waitForFunction(() => window.qa?.state.cloudTop.mapLayer?.currentFrameId, null, { timeout:60000 });
  if(await page.locator('#accept-trial-notice').isVisible()) await page.locator('#accept-trial-notice').click();
  const results=[];
  const snapshot = () => page.evaluate(() => {
    const m=qa.map,c=m.getCanvas(); return {center:m.getCenter().toArray(),zoom:m.getZoom(),bearing:m.getBearing(),pitch:m.getPitch(),width:c.clientWidth,height:c.clientHeight,
      horizontal:[m.unproject([0,c.clientHeight/2]).toArray(),m.unproject([c.clientWidth,c.clientHeight/2]).toArray()]};
  });
  async function save(name) {
    await page.waitForFunction(() => qa.map.loaded() && !qa.map.isMoving() && !qa.state.referenceRoads.exportPending && !qa.state.referenceRoads.pendingFrame);
    if(!await page.locator('#toolbar-save-image').isVisible()) await page.locator('#toolbar-compact-trigger').click();
    const before=await snapshot();
    const download=page.waitForEvent('download',{timeout:50000});
    await page.locator('#toolbar-save-image').click();
    try{await(await download).saveAs(path.join(out,`${name}.png`));}
    catch(e){console.log('EXPORT ERROR',await page.locator('#map-export-status').innerText());throw e;}
    const after=await snapshot();
    assert.deepEqual(after,before,'Live viewport must not change');
    const exported=await page.evaluate(()=>qaExport);
    const distance=parseFloat(exported.scale.label)*(exported.scale.label.endsWith('km')?1000:1);
    assert.ok(Math.abs(exported.scaleMeters/distance-1)<0.0001,'Graphic scale measures the stated ground distance');
    if(name.includes('goes')) {
      assert.equal(exported.goes.length,1,'Only one frozen GOES frame');
      assert.equal(exported.goes[0].url,exported.frozenUrl,'Exact active frame reused');
    }
    for(const key of ['zoom','bearing','pitch']) assert.ok(Math.abs(exported[key]-before[key])<1e-9);
    exported.center.forEach((v,i)=>assert.ok(Math.abs(v-before.center[i])<1e-8));
    exported.horizontal.flat().forEach((v,i)=>assert.ok(Math.abs(v-before.horizontal.flat()[i])<1e-7));
    const meta=await sharp(path.join(out,`${name}.png`)).metadata(); assert.deepEqual([meta.width,meta.height],[2047,1576]);
    const raw=Buffer.from((await page.evaluate(()=>qaRaw)).split(',')[1],'base64');
    const area={left:0,top:160,width:1000,height:1040};
    const a=await sharp(raw).extract(area).raw().toBuffer();
    const b=await sharp(path.join(out,`${name}.png`)).extract(area).raw().toBuffer();
    assert.equal(Buffer.compare(a,b),0,'No stretching after render');
    await sharp(path.join(out,`${name}.png`)).extract({left:0,top:1240,width:2047,height:336}).toFile(path.join(out,`${name}-detalle.png`));
    const logoPixels = await page.evaluate(async finalPng => {
      const load = src => new Promise((resolve,reject) => {const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src;});
      const [raw, final, logo] = await Promise.all([load(qaRaw),load(finalPng),load('/assets/encabezadoform.png')]);
      const expected=document.createElement('canvas');expected.width=final.width;expected.height=final.height;
      const e=expected.getContext('2d');e.drawImage(raw,0,0);e.scale(2,2);e.imageSmoothingEnabled=true;e.imageSmoothingQuality='high';
      const w=210,h=w*logo.naturalHeight/logo.naturalWidth,x=10,y=final.height/2-10-h;
      e.globalAlpha=.75;e.drawImage(logo,x,y,w,h);e.globalAlpha=1;
      const actual=document.createElement('canvas');actual.width=final.width;actual.height=final.height;const a=actual.getContext('2d');a.drawImage(final,0,0);
      const rect=[Math.floor(x*2)-4,Math.floor(y*2)-4,w*2+8,h*2+8];
      const ep=e.getImageData(...rect).data,ap=a.getImageData(...rect).data;
      return {matches:ep.every((v,i)=>v===ap[i]),width:w*2,height:h*2};
    }, 'data:image/png;base64,'+fs.readFileSync(path.join(out,`${name}.png`)).toString('base64'));
    assert.ok(logoPixels.matches,'Marca y margen exterior son exactamente mapa + asset original, sin tarjeta blanca');
    assert.ok(exported.thematic?.title.startsWith("SE 02"));
    assert.equal(exported.thematic.classes.length,10);
    results.push({name,before,logoPixels,exported,dimensions:[2047,1576],unchangedViewport:true,rawPixelMatch:true});
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
    console.log('PASS',name);
  }
  const se02 = page.locator('[data-layer-id="backend-cmuhd3t7b000vl3b11fge7gny"] input[type="checkbox"]');
  await se02.check({timeout:60000});
  await page.waitForFunction(() => {
    const layer=qa.state.userLayers.find(l=>l.id==='backend-cmuhd3t7b000vl3b11fge7gny');
    return layer?.data?.features?.length && !qa.state.pendingLayerLoads.size && !qa.state.pendingPointIconLoads.size;
  });
  const points=await page.evaluate(()=>qa.state.userLayers.find(l=>l.id==='backend-cmuhd3t7b000vl3b11fge7gny').data.features.reduce((r,f)=>{const role=f.properties.__geometryRole;if(role==='manantial'||role==='pozo')r[role]=(r[role]||0)+1;return r;},{}));
  assert.deepEqual(points,{pozo:643,manantial:220});
  await save('satelite-goes');
  await page.evaluate(()=>qa.setCloudTopVisibility(false));
  await page.waitForFunction(()=>qa.map.isStyleLoaded());
  await page.evaluate(()=>{qa.state.activeBaseMap='topografico';qa.applyBaseMapVisibility('topografico');});
  await page.waitForFunction(()=>qa.map.getLayoutProperty('basemap-topografico','visibility')==='visible');
  await save('topografico');
  // CARTO is still unavailable; use real light OSM cartography only in this QA context.
  await page.evaluate(()=>{
    qa.map.setLayoutProperty('basemap-topografico','visibility','none');
    qa.map.addSource('qa-light-osm',{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'});
    qa.map.addLayer({id:'qa-light-osm',type:'raster',source:'qa-light-osm'},'satellite-layer');
    qa.state.activeBaseMap='OSM (prueba local)';
  });
  await save('claro-osm-prueba');
  await page.evaluate(()=>{
    const m=qa.map,c=m.getCanvas(),p=m.unproject([c.clientWidth/2,-45]);
    const data=new Uint8Array(16*16*4);for(let i=0;i<data.length;i+=4){data[i]=255;data[i+3]=255;}
    m.addImage('qa-icon',{width:16,height:16,data});
    m.addSource('qa-point',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'Point',coordinates:p.toArray()}}});
    m.addLayer({id:'qa-extra',type:'symbol',source:'qa-point',layout:{'icon-image':'qa-icon','icon-allow-overlap':true}});
  });
  await save('extension-icono');
  assert.ok(results.at(-1).exported.imageIds.includes('qa-icon'));assert.ok(results.at(-1).exported.addedPoint>0);
  await page.evaluate(()=>qa.map.jumpTo({bearing:22,pitch:30}));
  await save('inclinacion');
  await page.evaluate(()=>qa.map.jumpTo({bearing:0,pitch:0}));
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>qa.map.getCanvas().clientWidth<400);
  await save('movil-claro');
  await page.screenshot({path:path.join(out,'interfaz-movil.png')});
  await page.evaluate(()=>{
    qa.map.removeLayer('qa-extra');qa.map.removeSource('qa-point');
    qa.map.setLayoutProperty('qa-light-osm','visibility','none');
    qa.state.activeBaseMap='topografico';qa.applyBaseMapVisibility('topografico');
  });
  await save('movil-topografico');
  await page.waitForFunction(()=>qa.map.isStyleLoaded());
  await page.evaluate(()=>{qa.state.activeBaseMap='satelite';qa.applyBaseMapVisibility('satelite');qa.setCloudTopVisibility(true);});
  await page.waitForFunction(()=>qa.state.cloudTop.mapLayer?.currentFrameId);
  await save('movil-satelite-goes');
  await page.evaluate(()=>qa.setCloudTopVisibility(false));
  await page.setViewportSize({width:1440,height:760});
  await page.evaluate(()=>qa.map.jumpTo({center:[-99.23,18.93],zoom:15.4}));
  await page.waitForFunction(()=>qa.map.getLayoutProperty('vialidades-nivel-3-center','visibility')==='visible' && !qa.state.referenceRoads.exportPending && !qa.state.referenceRoads.pendingFrame);
  const roadsBefore=await page.evaluate(()=>JSON.stringify(qa.map.getStyle().sources['vialidades-nivel-3-source'].data));
  await save('vialidades-extension');
  assert.ok(results.at(-1).exported.roads>0,'Detailed road chunks loaded for export');
  assert.equal(await page.evaluate(()=>JSON.stringify(qa.map.getStyle().sources['vialidades-nivel-3-source'].data)),roadsBefore,'Live road source unchanged');
  await page.evaluate(()=>{window.showSaveFilePicker=async()=>{throw new DOMException('Cancelado','AbortError');};});
  await page.locator('#toolbar-save-image').click();
  await page.waitForFunction(()=>!document.querySelector('#toolbar-save-image').disabled && !document.querySelector('.app-shell').inert);
  assert.match(await page.locator('#map-export-status').innerText(),/cancelad/i);
  assert.equal(await page.locator('[aria-hidden="true"].maplibregl-map').count(),0,'Temporary export maps cleaned up');
  console.log('PASS cancellation and cleanup');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
