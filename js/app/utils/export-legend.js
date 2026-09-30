export function immutableLegendSnapshot(value) {
  if (!value) return null;
  const copy = structuredClone(value);
  const freeze = item => {
    if (item && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(copy);
}

function wrap(ctx, value, width) {
  const words = String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().split(/\s+/);
  const lines = []; let line = "";
  for (const word of words) {
    if (ctx.measureText(word).width > width + 1e-7) return null;
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width + 1e-7) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export const EXPORT_LEGEND = Object.freeze({
  font: 8.5, minFont: 8, titleExtra: 2, symbol: 11, symbolGap: 4,
  padding: 7, rowGap: 3, columnGap: 10, creditGap: 6, radius: 3,
  minWidth: 56, maxWidth: 320, titleWrapWidth: 180,
});

const intersects = (a, b) => b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

// All coordinates use the compositor's half-resolution output units, never screen DPR.
// Anchor to measured credits. No title/class truncation, hidden rows or reserved empty space.
export function layoutExportLegend(ctx, width, height, snapshot, placement) {
  if (!snapshot) return null;
  if (!placement?.annotations?.credits) throw new Error("Falta la posición calculada de los créditos.");
  const c = EXPORT_LEGEND, { credits, logo, scale } = placement.annotations;
  const right = credits.x + credits.width, margin = width - right;
  const maxWidth = Math.min(c.maxWidth, right - margin);
  const classes = (snapshot.classes || []).filter(item => item && String(item.label ?? "").trim());
  const mixed = new Set(classes.map(item => item.kind)).size > 1;
  const candidates = [];
  for (const font of [c.font, c.minFont]) for (let columns = 1; columns <= Math.min(3, classes.length || 1); columns++) {
    const titleFont = font + c.titleExtra, lineHeight = font + 2;
    ctx.font = `${font}px Arial, sans-serif`;
    const groups = Array.from({length:columns}, (_, column) => classes.slice(
      Math.ceil(classes.length * column / columns), Math.ceil(classes.length * (column + 1) / columns)));
    const available = maxWidth - 2 * c.padding - (columns - 1) * c.columnGap;
    const natural = groups.map(group => Math.max(0, ...group.map(item => c.symbol + c.symbolGap + ctx.measureText(String(item.label)).width)));
    const minima = groups.map(group => Math.max(0, ...group.flatMap(item => String(item.label).trim().split(/\s+/).map(word => c.symbol + c.symbolGap + ctx.measureText(word).width))));
    const minimumTotal = minima.reduce((a,b)=>a+b,0), naturalTotal = natural.reduce((a,b)=>a+b,0);
    if (minimumTotal > available) continue;
    // Allocate only when wrapping is necessary; short columns retain their own measured width.
    const budgets = naturalTotal <= available ? natural : minima.map((min,index) => min +
      (available - minimumTotal) * (natural[index] - min) / Math.max(1, naturalTotal - minimumTotal));
    const measuredGroups = groups.map((group,column) => group.map((item,index) => {
      const lines = wrap(ctx, item.label, budgets[column] - c.symbol - c.symbolGap);
      if (!lines) return null;
      const heading = mixed && (!index || group[index-1].kind !== item.kind) ? (item.kind === "raster" ? "Raster" : "Vector") : null;
      const textWidth = Math.max(0,...lines.map(line=>ctx.measureText(line).width));
      return {item,lines,heading,symbolWidth:c.symbol,textWidth,unitWidth:c.symbol+c.symbolGap+textWidth,
        height:Math.max(c.symbol,lines.length*lineHeight)+(heading?lineHeight+c.rowGap:0)};
    }));
    if (measuredGroups.some(group=>group.some(row=>!row))) continue;
    const columnWidths = measuredGroups.map(group=>Math.max(0,...group.map(row=>Math.max(row.unitWidth,row.heading?ctx.measureText(row.heading).width:0))));
    const groupWidth = columnWidths.reduce((a,b)=>a+b,0)+(columns-1)*c.columnGap;
    ctx.font = `bold ${titleFont}px Arial, sans-serif`;
    const titleLimit = Math.min(maxWidth-2*c.padding,Math.max(groupWidth,Math.min(c.titleWrapWidth,ctx.measureText(String(snapshot.title)).width)));
    const title = wrap(ctx,snapshot.title,titleLimit);
    if (!title || title.length > 6) continue;
    const titleWidth = Math.max(0,...title.map(line=>ctx.measureText(line).width));
    const boxWidth = Math.max(c.minWidth,Math.max(titleWidth,groupWidth)+2*c.padding);
    if (boxWidth > maxWidth) continue;
    const header = c.padding+title.length*(titleFont+2)+(classes.length?c.rowGap+2:0);
    const x = right-boxWidth;
    const groupX = x+(boxWidth-groupWidth)/2;
    const placed=[];let columnX=groupX;
    measuredGroups.forEach((group,column)=>{
      let offset=0;
      for(const row of group){
        placed.push({...row,x:columnX,labelX:columnX+c.symbol+c.symbolGap,y:header+offset,column,columnX,colWidth:columnWidths[column]});
        offset+=row.height+c.rowGap;
      }
      columnX+=columnWidths[column]+c.columnGap;
    });
    const contentHeight = Math.max(0,...placed.map(row=>row.y-header+row.height));
    const boxHeight = header+contentHeight+c.padding;
    let bottom = credits.y-c.creditGap;
    for(const obstacle of [logo,scale]){
      if(obstacle && x<obstacle.x+obstacle.width && right>obstacle.x) bottom=Math.min(bottom,obstacle.y-c.creditGap);
    }
    const box={x,y:bottom-boxHeight,width:boxWidth,height:boxHeight};
    if(box.y<margin || box.y+box.height>height-margin ||
      [placement.north,placement.heading,credits,logo,scale].some(obstacle=>intersects(box,obstacle))) continue;
    candidates.push({...box,title,titleWidth,titleFont,lineHeight,font,columns,columnWidths,groupWidth,
      sideSpace:(boxWidth-groupWidth)/2,rows:placed.map(row=>({...row,y:box.y+row.y}))});
  }
  if (candidates.length) {
    const fullSize = candidates.filter(box => box.font === c.font);
    const choices = fullSize.length ? fullSize : candidates;
    const single = choices.find(box => box.columns === 1);
    const two = choices.find(box => box.columns === 2);
    if (single && (!two || classes.length <= 6 || two.height > single.height * .75)) return single;
    if (two) return two;
    return single || choices[0];
  }
  throw new Error(`La leyenda completa de «${snapshot.title}» (${classes.length} clases) no cabe legiblemente en este formato. No se omitieron clases; no se generó el PNG.`);
}

export function drawExportLegend(ctx, width, height, snapshot, placement) {
  if (!snapshot) return null;
  ctx.save();
  try {
    ctx.globalAlpha = 1;
    const box = layoutExportLegend(ctx, width, height, snapshot, placement);
    const c = EXPORT_LEGEND;
    ctx.fillStyle = placement.background;
    ctx.beginPath(); ctx.roundRect(box.x, box.y, box.width, box.height, c.radius); ctx.fill();
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillStyle = "#fff"; ctx.font = `bold ${box.titleFont}px Arial, sans-serif`;
    box.title.forEach((line, i) => ctx.fillText(line, box.x + box.width / 2, box.y + c.padding + i * (box.titleFont + 2)));
    ctx.font = `${box.font}px Arial, sans-serif`;
    ctx.textAlign = "left";
    for (const row of box.rows) {
      const { item, x } = row;
      let y = row.y;
      if (row.heading) { ctx.fillStyle = "#fff"; ctx.save(); ctx.textAlign = "center"; ctx.fillText(row.heading, row.columnX + row.colWidth / 2, y); ctx.restore(); y += box.lineHeight + c.rowGap; }
      ctx.save();
      ctx.globalAlpha = snapshot.opacity ?? 1;
      ctx.fillStyle = item.color; ctx.strokeStyle = item.outlineColor || item.color; ctx.lineWidth = 1;
      if (item.image) {
        const icon = document.createElement("canvas"); icon.width = item.image.width; icon.height = item.image.height;
        icon.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(item.image.data), icon.width, icon.height), 0, 0);
        const ratio = Math.min(c.symbol / icon.width, c.symbol / icon.height);
        ctx.drawImage(icon, x, y, icon.width * ratio, icon.height * ratio);
      } else {
        ctx.beginPath();
        if (item.shape === "line") { ctx.moveTo(x, y + c.symbol / 2); ctx.lineTo(x + c.symbol, y + c.symbol / 2); ctx.lineWidth = Math.min(4, item.lineWidth || 2); ctx.strokeStyle = item.color; ctx.stroke(); }
        else {
          if (item.shape === "dot" || item.shape === "circle") ctx.arc(x + c.symbol / 2, y + c.symbol / 2, c.symbol * .4, 0, Math.PI * 2);
          else if (item.shape === "triangle") { ctx.moveTo(x + c.symbol / 2, y); ctx.lineTo(x + c.symbol, y + c.symbol); ctx.lineTo(x, y + c.symbol); ctx.closePath(); }
          else ctx.rect(x, y + 1, c.symbol, c.symbol - 2);
          ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore(); ctx.fillStyle = "#fff";
      row.lines.forEach((line, i) => ctx.fillText(line, row.labelX, y + i * box.lineHeight));
    }
    return box;
  } finally { ctx.restore(); }
}
