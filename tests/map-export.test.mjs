import test from "node:test";
import assert from "node:assert/strict";
import { exportDate, metricScale, trackExportErrors, captureMap } from "../js/app/utils/map-export.js";
import { CloudTopMapLayer } from "../js/app/weather/cloud-top-layer.js";
import { exportGeometry, snapshotStyle, assertGoesCoverage, extendExportGroundCoverage } from "../js/app/utils/map-export-renderer.js";

test("la extensión inclinada aumenta el plano lejano sin inventar suelo sobre el horizonte", () => {
  let recalculated = 0;
  const transform = { cameraToCenterDistance: 825, centerPoint: { y: 438.5 }, getHorizon: () => 404.87, _calcMatrices: () => recalculated++ };
  extendExportGroundCoverage(transform, 60);
  assert.equal(transform.getHorizon(), 439.5);
  assert.equal(recalculated, 1);
  const above = { ...transform, centerPoint: { y: 500 } };
  assert.throws(() => extendExportGroundCoverage(above, 60), /horizonte/);
});

test("el LOD lejano solo cambia el recorrido raster y conserva el centro y los vectores", () => {
  const t = { cameraToCenterDistance: 825, centerPoint: { y: 438.5 }, _edgeInsets: { top: 0, bottom: 0 },
    getHorizon: () => 404.87, _calcMatrices() {},
    coveringTiles() { return { top: this._edgeInsets.top, offset: this._edgeInsets.top - this._edgeInsets.bottom, center: this.centerPoint }; },
  };
  extendExportGroundCoverage(t, 60);
  assert.deepEqual(t.coveringTiles({ roundZoom: false }), { top: 0, offset: 0, center: t.centerPoint });
  assert.deepEqual(t.coveringTiles({ roundZoom: true }), { top: .1, offset: 0, center: t.centerPoint });
  assert.deepEqual(t._edgeInsets, { top: 0, bottom: 0 });
});

test("formato 2047:1576 conserva ancho lógico y añade territorio vertical en paisaje", () => {
  const geometry = exportGeometry(1200, 500);
  assert.equal(geometry.width, 1200);
  assert.equal(geometry.height, Math.ceil(1200 * 1576 / 2047));
  assert.equal(Math.floor(geometry.width * geometry.pixelRatio), 2047);
  assert.ok(Math.floor(geometry.height * geometry.pixelRatio) >= 1576);
  assert.ok(exportGeometry(390, 754).height < 754, "portrait preserves horizontal extent, not full vertical extent");
});

test("la perspectiva conserva distancia focal y bloquea FOV fuera del límite", () => {
  const g = exportGeometry(1200, 600, 36.87, 30);
  const focal = height => height / 2 / Math.tan(36.87 * Math.PI / 360);
  assert.ok(Math.abs(g.height / 2 / Math.tan(g.fov * Math.PI / 360) - focal(600)) < 1e-8);
  assert.throws(() => exportGeometry(1800, 300, 36.87, 40), /inclinación/);
});

test("la instantánea excluye buffers invisibles y no modifica el estilo original", () => {
  const style = { version: 8, sources: { active: { type: "image" }, hidden: { type: "image" } }, layers: [
    { id: "current", source: "active", type: "raster", paint: { "raster-opacity": .62 } },
    { id: "previous", source: "hidden", type: "raster", paint: { "raster-opacity": 0 } },
  ] };
  const copy = snapshotStyle({ getStyle: () => style, getZoom: () => 8 });
  assert.deepEqual(Object.keys(copy.sources), ["active"]);
  assert.equal(copy.layers.length, 1);
  assert.equal(style.layers.length, 2);
});

test("GOES fuera de cobertura detiene la exportación con alternativa explícita", () => {
  const map = { getCanvas: () => ({ width: 2047, clientWidth: 2047 }), unproject: () => ({ lng: -105, lat: 18 }) };
  const style = { sources: { "cloud-top-animation-source-1": { type: "image", coordinates: [[-101,20],[-96,20],[-96,17],[-101,17]] } } };
  assert.throws(() => assertGoesCoverage(map, style, { y: 0 }), /Acerca el mapa o desactiva GOES/);
});

test("fecha y nombre usan México incluso al cambiar de día en UTC", () => {
  assert.deepEqual(exportDate(new Date("2026-09-26T01:49:00Z")), {
    label: "25/09/2026 · 19:49", filename: "EGEM_Morelos_2026-09-25_1949.png",
  });
  assert.equal(exportDate(new Date("2026-09-25T06:00:00Z")).label, "25/09/2026 · 00:00");
});

test("escala gráfica mantiene la distancia geográfica y no excede el tramo medido", () => {
  assert.deepEqual(metricScale(13600, 100), { label: "10 km", pixels: 1000000 / 13600 });
  assert.deepEqual(metricScale(43, 90), { label: "20 m", pixels: 1800 / 43 });
  assert.throws(() => metricScale(0, 100), /escala/);
});

function mockMap() {
  const listeners = new Map();
  const source = {};
  const map = {
    layers: [{ id: "tiles", source: "provider", type: "raster", paint: {} }], source,
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    off(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type, event = {}) { [...listeners.get(type) || []].forEach(fn => fn(event)); },
    getStyle() { return { layers: this.layers }; },
    getSource() { return this.source; }, getZoom() { return 8; },
    getCenter() { return { lng: -99, lat: 19 }; }, getBearing() { return 0; }, getPitch() { return 0; },
    getCanvas() { return { width: 800, height: 600, clientWidth: 800, clientHeight: 600 }; },
    stop() {}, triggerRepaint() {},
    dragPan: { enabled: true, isEnabled() { return this.enabled; }, disable() { this.enabled = false; }, enable() { this.enabled = true; } },
    listenerCount() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); },
  };
  return map;
}

test("tiles fallidos visibles bloquean; ocultos y fuentes recreadas no contaminan otras capturas", () => {
  const map = mockMap();
  const check = trackExportErrors(map);
  map.fire("error", { sourceId: "provider", error: new Error("https://proveedor/tile: CORS") });
  assert.throws(check, /provider.*CORS/);
  map.layers[0].layout = { visibility: "none" };
  assert.doesNotThrow(check);
  map.layers[0].layout.visibility = "visible";
  map.source = {};
  assert.doesNotThrow(check);
});

test("timeout libera interacción y todos los listeners", async () => {
  const map = mockMap();
  await assert.rejects(captureMap(map, { date: exportDate(), check() {}, timeoutMs: 5 }), /no terminó/);
  assert.equal(map.dragPan.enabled, true);
  assert.equal(map.listenerCount(), 0);
});

test("un logotipo fallido cancela la exportación y restituye la interacción", async () => {
  const map = mockMap();
  await assert.rejects(captureMap(map, {
    date: exportDate(), check() {},
    logo: Promise.reject(new Error("No se pudo cargar assets/encabezadoform.png")),
  }), /encabezadoform\.png/);
  assert.equal(map.dragPan.enabled, true);
  assert.equal(map.listenerCount(), 0);
});

test("cancelar o redimensionar durante carga libera la captura sin PNG", async () => {
  for (const event of ["abort", "resize"]) {
    const map = mockMap();
    const controller = new AbortController();
    const promise = captureMap(map, { date: exportDate(), check() {}, signal: controller.signal });
    if (event === "abort") controller.abort(); else map.fire("resize");
    await assert.rejects(promise, event === "abort" ? /cancelada/ : /vista cambió/);
    assert.equal(map.dragPan.enabled, true);
    assert.equal(map.listenerCount(), 0);
  }
});

test("GOES no intercambia buffers si termina una precarga durante la congelación", async () => {
  const layers = new Map();
  const map = {
    getLayer: id => layers.get(id),
    getPaintProperty: (id, name) => layers.get(id).paint[name],
    setPaintProperty: (id, name, value) => { layers.get(id).paint[name] = value; },
  };
  const layer = new CloudTopMapLayer(map, { opacity: .62 });
  layer.getLayerIds().forEach(id => layers.set(id, { paint: { "raster-opacity": .31 } }));
  let releaseLoad;
  layer.preloadFrame = () => new Promise(resolve => { releaseLoad = resolve; });
  const pending = layer.showFrame({ id: "next", url: "next.png", bounds: [-100,18,-98,20] });
  const restore = layer.freezeForExport();
  releaseLoad();
  await pending;
  assert.equal(layer.activeBuffer, 0);
  assert.equal(layers.get(layer.getLayerId(0)).paint["raster-opacity"], .62);
  assert.equal(layers.get(layer.getLayerId(1)).paint["raster-opacity"], 0);
  restore();
  assert.equal(layer.exportFrozen, false);
});

// A fresh MapLibre map has an initial style whose load is asynchronous. Exercise
// the actual export-scene constructor against that lifecycle, including icons.
test("export scene installs its snapshot without diffing an unloaded style", async () => {
  const { createExportScene } = await import("../js/app/utils/map-export-renderer.js");
  const previousDocument = globalThis.document;
  let removed = false;
  globalThis.document = { createElement: () => ({ setAttribute() {}, style: {}, remove() { removed = true; } }), body: { append() {} } };
  class SceneMap {
    constructor() { this.handlers = {}; this.images = new Map(); }
    jumpTo() {}
    project(p) { return { x: p[0], y: p[1] }; }
    getCanvas() { return { width: 2047, height: 1576, clientWidth: 2047 }; }
    getBounds() { return {}; }
    on(event, fn) { this.handlers[event] = fn; }
    hasImage(id) { return this.images.has(id); }
    addImage(id, data) { this.images.set(id, data); }
    setStyle(style, options) {
      if (options?.diff !== false) throw new Error('Style is not done loading');
      this.style = style; this.handlers['style.load']();
    }
    remove() {}
  }
  const original = { constructor: SceneMap, stop() {},
    getCanvas: () => ({ clientWidth: 2047, clientHeight: 1576 }),
    getStyle: () => ({ version: 8, sources: {}, layers: [] }),
    getZoom: () => 8, getPitch: () => 0, getBearing: () => 0, getPadding: () => ({}),
    getCenter: () => ({ toArray: () => [0, 0] }), getRenderWorldCopies: () => false,
    unproject: p => p, listImages: () => ['point'],
    getImage: () => ({ data: { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) }, pixelRatio: 1 }),
  };
  try {
    const scene = await createExportScene(original, { signal: new AbortController().signal });
    scene.check();
    assert.deepEqual([...scene.map.images.get('point').data], [1, 2, 3, 255]);
    scene.destroy(); assert.equal(removed, true);
  } finally { globalThis.document = previousDocument; }
});

import { annotationLayout, EXPORT_ANNOTATIONS, drawAnnotations } from '../js/app/utils/map-export.js';

const measuredContext = () => ({font:'', measureText(text) {return {width:text.length*parseFloat(this.font.match(/[\d.]+px/)[0])*.51};}});
const overlaps = (a,b) => a.width && b.width && a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
for (const [width,height] of [[1023.5,788],[600,350],[390,844],[2047,1576]]) {
  test(`anotaciones independientes y escala centrada ${width}x${height}`, () => {
    for(const text of ['Satélite · Esri', 'Mapa topográfico de nombre largo para prueba · © OpenStreetMap contributors · GOES IR · 29-sep 12:30 · NOAA nowCOAST']) {
      const scale=metricScale(23000,Math.min(100,width*.13));
      const layout=annotationLayout(measuredContext(),width,height,scale,text,4);
      assert.equal(layout.scale.x+layout.scale.width/2,width/2);
      assert.equal(layout.logo.x,EXPORT_ANNOTATIONS.margin);
      assert.equal(layout.logo.y+layout.logo.height,height-EXPORT_ANNOTATIONS.margin);
      assert.ok(layout.logo.width<=210 && layout.logo.width<340);
      assert.equal(layout.logo.width/layout.logo.height,4);
      assert.ok(Math.abs(layout.credits.x+layout.credits.width-(width-EXPORT_ANNOTATIONS.margin))<1e-9);
      assert.ok(layout.credits.lines.length<=2);
      assert.equal(layout.credits.lines.join(' '),text);
      for(const a of Object.values(layout)) {
        assert.ok(a.x>=0 && a.y>=0 && a.x+a.width<=width && a.y+a.height<=height);
        for(const b of Object.values(layout)) if(a!==b) assert.ok(!overlaps(a,b));
      }
    }
  });
}

test('marca 75%, escala sin fondo y créditos 38%, sin propagación de alfa', () => {
  const text=[],backgrounds=[],images=[];const ctx={...measuredContext(),save(){},restore(){},beginPath(){},roundRect(){},fill(){backgrounds.push(this.fillStyle)},drawImage(...args){images.push([...args,this.globalAlpha])},strokeText(){},fillText(value){text.push(value);assert.equal(this.globalAlpha,1)},moveTo(){},lineTo(){},stroke(){}};
  const previous=globalThis.DOMParser;globalThis.DOMParser=class {parseFromString(s){return {body:{textContent:s}}}};
  try {
    const originalLogo = {naturalWidth:3200,naturalHeight:800};
    drawAnnotations(ctx,1023.5,788,{pixels:85,label:'10 km'},['Esri'],originalLogo,'Satélite');
    assert.equal(images[0][0], originalLogo, 'drawImage recibe el asset original, sin máscara ni reconstrucción');
    assert.equal(ctx.globalAlpha, 1);
    assert.deepEqual(backgrounds,['rgba(0,0,0,0.38)']);
    assert.equal(images[0].at(-1),.75);
    assert.deepEqual(images[0].slice(3,5),[210,52.5]);
    assert.equal(images.length,1);assert.deepEqual(text,['10 km','Satélite · Esri']);
    assert.ok(!text.some(t=>/\d{2}[:/]\d{2}/.test(t)));
  } finally {globalThis.DOMParser=previous;}
});

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

test("asset institucional conserva exactamente el fondo guinda y los píxeles originales", () => {
  const bytes = readFileSync(new URL("../assets/encabezadoform.png", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "96457d15f37030b8a3348841e46a1e0416d404be5793dcac3d2acd0e69ca4a6e");
});

import { northRotation, captureExportOrientation, drawExportNorth } from '../js/app/utils/map-export.js';
for (const [bearing, expected] of [[0,0],[45,-45],[90,-90],[180,-180],[270,90],[-45,45],[-90,90],[359.95,0],[360,0],[720,0],[-720,0],[-.05,0],[360.05,0],[.11,-.11]]) {
  test(`norte geográfico: bearing ${bearing} -> ${expected}`, () => assert.ok(Math.abs(northRotation(bearing)-expected)<1e-9));
}
function northContext() {
  const calls=[];const ctx={calls};
  for(const name of ['save','restore','translate','scale','rotate','beginPath','arc','fill','stroke','fillText','moveTo','lineTo','closePath'])ctx[name]=(...args)=>calls.push([name,...args]);
  return ctx;
}
test('snapshot de orientación es inmutable e independiente de la cámara posterior', () => {
  let bearing=45,pitch=30;const snapshot=captureExportOrientation({getBearing:()=>bearing,getPitch:()=>pitch});
  bearing=90;pitch=60;
  assert.deepEqual(snapshot,{bearing:45,pitch:30});assert.ok(Object.isFrozen(snapshot));
  assert.throws(()=>{snapshot.bearing=180},TypeError);
  assert.throws(()=>northRotation(NaN),/orientación/);
});
test('pitch 0, intermedio y máximo 85 no afectan ángulo ni deforman el norte', () => {
  const drawings=[0,35,85].map(pitch=>{const ctx=northContext();drawExportNorth(ctx,1023.5,788,{bearing:45,pitch});return ctx.calls});
  assert.deepEqual(drawings[0],drawings[1]);assert.deepEqual(drawings[0],drawings[2]);
  assert.ok(drawings[0].some(([name,text])=>name==='fillText'&&text==='N'));
  for(const [name,x,y] of drawings[0]) if(name==='scale')assert.equal(x,y);
  assert.deepEqual(drawings[0].filter(c=>c[0]==='rotate'),[['rotate',-Math.PI/4]]);
});
for(const [width,height] of [[1023.5,788],[292,544],[584,1088],[2047,1576]]) {
  test(`norte visible y dentro de canvas ${width}x${height}, sin colisión con pie`, () => {
    const ctx=northContext();const north=drawExportNorth(ctx,width,height,{bearing:0,pitch:0});
    assert.equal(north.angle,0);assert.equal(north.width,north.height);
    assert.ok(north.x>0&&north.y>0&&north.x+north.width<width&&north.y+north.height<height);
    assert.ok(Math.abs(width-north.x-north.width-north.y)<1e-9);
    const footer=annotationLayout(measuredContext(),width,height,metricScale(10000,Math.min(100,width*.13)),'Satélite · Esri · GOES IR · NOAA',4);
    for(const block of Object.values(footer))assert.ok(!overlaps(north,block));
  });
}
test('cambio de orientación antes del render no produce un PNG con norte obsoleto', async () => {
  const map=mockMap();const orientation=captureExportOrientation(map);map.getBearing=()=>90;
  await assert.rejects(captureMap(map,{orientation,check(){}}),/orientación cambió/);
  assert.equal(map.listenerCount(),0);assert.equal(map.dragPan.enabled,true);
});

for (const bearing of [0,45,90,135,180,270,-45,-90,359.95]) {
  test(`N junto a la punta y vertical: bearing ${bearing}, pitch 0/60`, () => {
    const results=[];
    for(const pitch of [0,60]) {
      const ctx=northContext();let rotation=0;const stack=[];let text;
      ctx.save=()=>stack.push(rotation);ctx.restore=()=>{rotation=stack.pop()};
      ctx.rotate=angle=>{rotation+=angle};
      ctx.fillText=(glyph,x,y)=>{text={glyph,x,y,rotation,align:ctx.textAlign,baseline:ctx.textBaseline,font:ctx.font}};
      const box=drawExportNorth(ctx,1023.5,788,{bearing,pitch});
      const radians=northRotation(bearing)*Math.PI/180;
      assert.equal(text.glyph,'N');assert.equal(text.rotation,0);
      assert.equal(text.align,'center');assert.equal(text.baseline,'middle');
      assert.equal(text.font,'bold 11px Arial, sans-serif');
      assert.ok(Math.abs(text.x-23*Math.sin(radians))<1e-9);
      assert.ok(Math.abs(text.y+23*Math.cos(radians))<1e-9);
      assert.ok(Math.abs(Math.hypot(box.label.x-box.tip.x,box.label.y-box.tip.y)-9)<1e-9);
      // Conservative 10×12 glyph envelope: every corner remains in the circle.
      for(const dx of [-5,5])for(const dy of [-6,6])assert.ok(Math.hypot(text.x+dx,text.y+dy)<32);
      assert.ok(23-Math.hypot(5,6)>14.6,'Glyph cannot touch arrow tip or its stroke');
      results.push({text,box});
    }
    assert.deepEqual(results[0],results[1]);
  });
}

import { BRAND_WATERMARK_OPACITY, EGEM_HEADING, drawExportHeading } from '../js/app/utils/map-export.js';
test('alfa 75% aislado con save/restore; escala solo halo y barra sin tarjeta', () => {
  const events=[],stack=[];const ctx={...measuredContext(),globalAlpha:1,
    save(){stack.push(this.globalAlpha);events.push(['save'])},restore(){this.globalAlpha=stack.pop();events.push(['restore'])},
    drawImage(){events.push(['image',this.globalAlpha])},beginPath(){},moveTo(){},lineTo(){},
    strokeText(t){events.push(['strokeText',t,this.globalAlpha,this.strokeStyle])},
    fillText(t){events.push(['fillText',t,this.globalAlpha,this.fillStyle])},
    stroke(){events.push(['stroke',this.globalAlpha,this.strokeStyle,this.lineWidth])},
    fill(){assert.fail('La escala no debe dibujar rellenos')},roundRect(){assert.fail('La escala no debe dibujar tarjetas')}
  };
  const previous=globalThis.DOMParser;globalThis.DOMParser=class{parseFromString(s){return{body:{textContent:s}}}};
  try {
    drawAnnotations(ctx,1023.5,788,{pixels:85,label:'10 km'},[],{naturalWidth:3200,naturalHeight:800});
    assert.equal(BRAND_WATERMARK_OPACITY,.75);const i=events.findIndex(e=>e[0]==='image');
    assert.deepEqual(events.slice(i-1,i+2),[['save'],['image',.75],['restore']]);
    assert.equal(ctx.globalAlpha,1);assert.equal(stack.length,0);
    assert.deepEqual(events.filter(e=>e[0]==='strokeText'||e[0]==='fillText'),[['strokeText','10 km',1,EXPORT_ANNOTATIONS.scaleHalo],['fillText','10 km',1,'#fff']]);
    assert.deepEqual(events.filter(e=>e[0]==='stroke'),[['stroke',1,EXPORT_ANNOTATIONS.scaleHalo,3],['stroke',1,'#fff',1.5]]);
  } finally {globalThis.DOMParser=previous;}
});
for(const [width,height] of [[1023.5,788],[292,544],[584,1088],[2047,1576]]) {
  test(`EGEM guinda con halo sin tarjeta, superior izquierdo ${width}x${height}`,()=>{
    const events=[];const ctx={...measuredContext(),save(){},restore(){},scale(x,y){assert.equal(x,y)},
      strokeText(t,x,y){events.push(['halo',t,x,y,this.strokeStyle,this.globalAlpha])},
      fillText(t,x,y){events.push(['text',t,x,y,this.fillStyle,this.globalAlpha])}};
    const box=drawExportHeading(ctx,width,height);
    assert.equal(EGEM_HEADING.color,'#501C32');
    assert.deepEqual(events.map(e=>[e[0],e[1],e[4],e[5]]),[['halo','EGEM',EGEM_HEADING.halo,1],['text','EGEM','#501C32',1]]);
    assert.equal(box.x,box.y);assert.ok(box.x>0&&box.y>0&&box.x+box.width<width&&box.y+box.height<height);
    assert.ok(!overlaps(box,drawExportNorth(northContext(),width,height,{bearing:90,pitch:60})));
    const footer=annotationLayout(measuredContext(),width,height,{pixels:60,label:'10 km'},'Satélite · GOES',4);
    for(const block of Object.values(footer))assert.ok(!overlaps(box,block));
  });
}
