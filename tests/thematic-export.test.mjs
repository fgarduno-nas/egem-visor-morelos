import test from 'node:test';
import assert from 'node:assert/strict';
import { createThematicSelection, latestThematicId } from '../js/app/utils/thematic-selection.js';
import { immutableLegendSnapshot, layoutExportLegend as layout, drawExportLegend as draw, EXPORT_LEGEND } from '../js/app/utils/export-legend.js';

import { annotationLayout, EXPORT_ANNOTATIONS } from '../js/app/utils/map-export.js';
const placement = (ctx,w,h,text='Mapa base · proveedor') => ({
  annotations: annotationLayout(ctx,w,h,{pixels:50,label:'10 km'},text,4),
  north:{x:w-74,y:10,width:64,height:64}, heading:{x:10,y:10,width:70,height:18},
  background:EXPORT_ANNOTATIONS.creditBackground,
});
const layoutExportLegend=(ctx,w,h,snapshot,p)=>layout(ctx,w,h,snapshot,p||placement(ctx,w,h));
const drawExportLegend=(ctx,w,h,snapshot,p)=>snapshot?draw(ctx,w,h,snapshot,p||placement(ctx,w,h)):draw(ctx,w,h,null);
const context = () => ({font:'10px Arial',measureText(t){return {width:t.length*Number(this.font.match(/([\d.]+)px/)[1])*.52}}});
const legend = (count=10) => ({id:'A',title:'Nombre completo de la capa temática',opacity:.8,classes:Array.from({length:count},(_,i)=>({label:`Clase ${i+1}`,shape:'dot',color:'#f7bbf2'}))});

test('selection A/B/C invalidates earlier work immediately and can leave no layer',()=>{
  const selection=createThematicSelection(); assert.equal(selection.id,null);
  const a=selection.select('A'),b=selection.select('B'),c=selection.select('C');
  assert.equal(selection.id,'C'); assert.ok(a.signal.aborted&&b.signal.aborted); assert.ok(c.current());
  selection.clear(); assert.ok(c.signal.aborted); assert.equal(selection.id,null);
});
for(const resource of ['vector','raster','ground-overlay','mixed','slow icons','heavy GeoJSON','HTTP failure','timeout']) test(`stale ${resource} cannot commit after replacement`,async()=>{
  const selection=createThematicSelection(), writes=[]; let resolve;
  const a=selection.select('A');const request=new Promise(r=>resolve=r).then(()=>{if(a.current())writes.push('A')});
  const b=selection.select('B'); if(b.current())writes.push('B'); resolve();await request;
  assert.deepEqual(writes,['B']);
});
test('session/catalog invalidation rejects an outstanding activation',()=>{
  const s=createThematicSelection(),a=s.select('A');s.clear();assert.equal(a.current(),false);
});
test('legacy multiple selection keeps latest valid ID only, ignores removed IDs',()=>{
  const layers=[{id:'A',visible:true},{id:'B',visible:true},{id:'C',visible:false}];
  assert.equal(latestThematicId(layers,['B','A','missing']),'A');
  assert.equal(latestThematicId(layers,[]),'B');assert.equal(latestThematicId([],[]),null);
});
test('snapshot deeply copies symbols, edited labels/colors, camera and GOES',()=>{
  const source={...legend(),bearing:90,pitch:60,goes:{frame:'old'},vectorLegend:{classes:[{color:'red'}]}};
  const snap=immutableLegendSnapshot(source);source.classes[0].color='black';source.goes.frame='new';
  assert.equal(snap.classes[0].color,'#f7bbf2');assert.equal(snap.goes.frame,'old');assert.ok(Object.isFrozen(snap.classes[0]));
  assert.throws(()=>snap.classes.push({}));
});
for(const [width,height] of [[1023.5,788],[584,1088],[292,544]]) test(`complete title/classes fit ${width}x${height}`,()=>{
  const snap=legend();const box=layoutExportLegend(context(),width,height,snap);
  assert.equal(box.rows.length,10);assert.equal(box.title.join(' '),snap.title);
  assert.equal(box.x+box.width,width-EXPORT_ANNOTATIONS.margin);
  const anchor=placement(context(),width,height); assert.ok(box.y+box.height<=anchor.annotations.credits.y-EXPORT_LEGEND.creditGap);
  assert.ok(box.y>anchor.north.y+anchor.north.height);
  assert.deepEqual(box.rows.map(r=>r.item.label),snap.classes.map(c=>c.label));
});
test('long title wraps whole words; malicious text stays literal canvas text',()=>{
  const snap={...legend(),title:'Un título completo muy extenso sobre peligros y vulnerabilidad en varios municipios <img onerror=alert(1)>'};
  const box=layoutExportLegend(context(),1023.5,788,snap);assert.equal(box.title.join(' '),snap.title);
});
test('extensive legend uses columns without dropping classes',()=>{
  const box=layoutExportLegend(context(),1023.5,788,legend(65));assert.ok(box.columns>1);assert.equal(box.rows.length,65);
});
test('unfittable legend fails explicitly instead of hiding classes',()=>assert.throws(()=>layoutExportLegend(context(),292,544,legend(500)),/500 clases/));
test('no thematic layer draws no title or empty block',()=>assert.equal(drawExportLegend({},100,100,null),null));
test('symbols, labels and opacity drawn without inheriting logo alpha',()=>{
  const texts=[],ctx={...context(),globalAlpha:1,save(){},restore(){},beginPath(){},roundRect(){},fill(){},stroke(){},arc(){},rect(){},moveTo(){},lineTo(){},closePath(){},fillText(t){texts.push(t)}};
  const snap=legend(4);snap.classes.forEach((c,i)=>c.shape=['dot','triangle','line','box'][i]);
  drawExportLegend(ctx,1023.5,788,snap);assert.ok(texts.join(" ").startsWith(snap.title));for(const c of snap.classes)assert.ok(texts.includes(c.label));
});

for (const count of [1,5,10]) test(`compact left-aligned ${count}-class legend`,()=>{
  const ctx=context(),anchor=placement(ctx,1023.5,788),box=layoutExportLegend(ctx,1023.5,788,legend(count),anchor);
  assert.equal(box.columns,count===10?2:1);assert.equal(box.font,8.5);assert.equal(box.titleFont,10.5);
  assert.ok(box.width<=250);assert.equal(box.x+box.width,anchor.annotations.credits.x+anchor.annotations.credits.width);
  for(const row of box.rows){assert.equal(row.x,row.columnX);assert.equal(row.labelX,row.columnX+EXPORT_LEGEND.symbol+EXPORT_LEGEND.symbolGap)}
});
test('legend follows actual credit height automatically with unchanged scale',()=>{
  const ctx=context(),p=placement(ctx,1023.5,788),a=layoutExportLegend(ctx,1023.5,788,legend(),p);
  const higher=structuredClone(p);higher.annotations.credits.y-=12;higher.annotations.credits.height+=12;
  const b=layoutExportLegend(ctx,1023.5,788,legend(),higher);
  assert.equal(a.y-b.y,12);assert.deepEqual(higher.annotations.scale,p.annotations.scale);
});
test('background drawn once at shared 38 percent and title centered',()=>{
  const fills=[],texts=[],stack=[];const ctx={...context(),globalAlpha:1,save(){stack.push({alpha:this.globalAlpha,align:this.textAlign})},restore(){const s=stack.pop();this.globalAlpha=s.alpha;this.textAlign=s.align},beginPath(){},roundRect(){this.card=true},fill(){if(this.card){fills.push({color:this.fillStyle,alpha:this.globalAlpha});this.card=false}},stroke(){},arc(){},rect(){},moveTo(){},lineTo(){},closePath(){},fillText(text,x,y){texts.push({text,x,y,align:this.textAlign})}};
  const p=placement(ctx,1023.5,788),box=drawExportLegend(ctx,1023.5,788,legend(),p);
  assert.deepEqual(fills,[{color:EXPORT_ANNOTATIONS.creditBackground,alpha:1}]);
  for(const line of texts.slice(0,box.title.length)){assert.equal(line.align,'center');assert.equal(line.x,box.x+box.width/2)}
});
test('long labels wrap without clipping and retain their column alignment',()=>{
  const snap=legend(5);snap.classes[0].label='Una etiqueta extensa con palabras completas para comprobar la alineación';
  const box=layoutExportLegend(context(),1023.5,788,snap);
  assert.equal(box.rows[0].lines.join(' '),snap.classes[0].label);assert.ok(box.rows[0].lines.length>1);
  for(const row of box.rows){assert.equal(row.x,row.columnX);assert.equal(row.labelX,row.columnX+EXPORT_LEGEND.symbol+EXPORT_LEGEND.symbolGap)}
});

test('width follows measured content instead of fixed column sizes',()=>{
  const short={...legend(1),title:'Río',classes:[{label:'A',shape:'line',color:'#123456'}]};
  const long=structuredClone(short);long.classes[0].label='Una etiqueta considerablemente más larga';
  const a=layoutExportLegend(context(),1023.5,788,short),b=layoutExportLegend(context(),1023.5,788,long);
  assert.ok(a.width<b.width);assert.equal(a.width,EXPORT_LEGEND.minWidth);
  assert.equal(b.width,Math.max(EXPORT_LEGEND.minWidth,Math.max(b.titleWidth,b.groupWidth)+2*EXPORT_LEGEND.padding));
  assert.equal(a.x+a.width,b.x+b.width);
});
test('unequal columns use independent widths and share one centered group',()=>{
  const snap={...legend(10),title:'Clases'};snap.classes.forEach((c,i)=>c.label=i<5?'Una etiqueta más larga':'A');
  const box=layoutExportLegend(context(),1023.5,788,snap);assert.equal(box.columns,2);
  assert.ok(box.columnWidths[0]>box.columnWidths[1]);
  assert.equal(box.rows[0].x,box.x+(box.width-box.groupWidth)/2);
  for(const col of [0,1]){const rows=box.rows.filter(r=>r.column===col);assert.equal(new Set(rows.map(r=>r.x)).size,1);assert.equal(new Set(rows.map(r=>r.labelX)).size,1)}
});
test('title-only snapshot has compact measured height without invented symbols',()=>{
  const snap={id:'A',title:'Solo título',classes:[null,{label:''}]};const box=layoutExportLegend(context(),1023.5,788,snap);
  assert.equal(box.rows.length,0);assert.equal(box.columns,1);
  assert.equal(box.height,2*EXPORT_LEGEND.padding+box.title.length*(box.titleFont+2));
});
test('one, five and ten classes have measured bottom padding, never an SE02 fixed height',()=>{
  const sizes=[];for(const count of [1,5,10]){
    const box=layoutExportLegend(context(),1023.5,788,{...legend(count),title:'Clases'});
    const bottom=Math.max(...box.rows.map(row=>row.y+row.height));
    assert.equal(box.y+box.height-bottom,EXPORT_LEGEND.padding);sizes.push(box.height);
  }assert.ok(sizes[0]<sizes[1]);
});
test('narrow icons still use a common symbol slot and label indent',()=>{
  const snap=legend(5);snap.classes[0].image={width:4,height:12,data:[]};snap.classes[1].label='Texto corto';
  const box=layoutExportLegend(context(),1023.5,788,snap);
  assert.equal(new Set(box.rows.map(r=>r.labelX)).size,1);assert.equal(new Set(box.rows.map(r=>r.x)).size,1);
});
