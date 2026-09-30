import { drawExportLegend } from "./export-legend.js";
const HANDLERS = ["scrollZoom", "boxZoom", "dragRotate", "dragPan", "keyboard", "doubleClickZoom", "touchZoomRotate", "touchPitch"];
import { createExportScene } from "./map-export-renderer.js";
export const BRAND_WATERMARK_OPACITY = .75;
export const EGEM_HEADING = Object.freeze({ text: "EGEM", color: "#501C32", fontSize: 18, halo: "rgba(255,255,255,0.85)", haloWidth: 2 });
export const EXPORT_ANNOTATIONS = Object.freeze({
  margin: 10, gap: 12, padding: 6, logoWidth: 210, logoFraction: .24,
  creditFont: 8.5, minCreditFont: 7.5, scaleFont: 11,
  creditBackground: "rgba(0,0,0,0.38)", scaleHalo: "rgba(0,0,0,0.75)", scaleHaloWidth: 2,
});

export const EXPORT_NORTH = Object.freeze({ radius: 32, labelRadius: 23, margin: 10, zeroTolerance: .1, background: "rgba(0,0,0,0.64)", burgundy: "#501c32" });

// Geographic north, not magnetic/device heading. Pitch is traceability only.
export function northRotation(bearing) {
  if (!Number.isFinite(bearing)) throw new Error("La orientación del mapa no es válida.");
  const angle = ((-bearing % 360) + 540) % 360 - 180;
  return Math.abs(angle) <= EXPORT_NORTH.zeroTolerance ? 0 : angle;
}

export function captureExportOrientation(map) {
  const bearing = map.getBearing(), pitch = map.getPitch();
  northRotation(bearing);
  if (!Number.isFinite(pitch)) throw new Error("La inclinación del mapa no es válida.");
  return Object.freeze({ bearing, pitch });
}

export function drawExportNorth(ctx, width, height, orientation) {
  const angle = northRotation(orientation.bearing);
  const size = Math.max(.5, Math.min(width / 1023.5, height / 788));
  const radius = EXPORT_NORTH.radius * size, margin = EXPORT_NORTH.margin * size;
  const x = width - margin - radius, y = margin + radius;
  ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(0, 0, EXPORT_NORTH.radius, 0, Math.PI * 2);
  ctx.fillStyle = EXPORT_NORTH.background; ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = .8; ctx.stroke();
  const radians = angle * Math.PI / 180;
  const labelX = Math.sin(radians) * EXPORT_NORTH.labelRadius;
  const labelY = -Math.cos(radians) * EXPORT_NORTH.labelRadius;
  // Arrow and label orbit share the badge center. Restore rotation before text:
  // its anchor follows north, while the glyph stays upright at every bearing.
  ctx.save(); ctx.rotate(radians);
  ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(-8, 13); ctx.lineTo(0, 8); ctx.lineTo(8, 13); ctx.closePath();
  ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(8, 13); ctx.lineTo(0, 8); ctx.closePath();
  ctx.fillStyle = EXPORT_NORTH.burgundy; ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#fff"; ctx.font = "bold 11px Arial, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("N", labelX, labelY);
  ctx.restore();
  return { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2, angle,
    label: { x: x + labelX * size, y: y + labelY * size },
    tip: { x: x + Math.sin(radians) * 14 * size, y: y - Math.cos(radians) * 14 * size } };

}

export function drawExportHeading(ctx, width, height) {
  const size = Math.max(.5, Math.min(width / 1023.5, height / 788));
  const margin = EXPORT_NORTH.margin;
  ctx.save(); ctx.scale(size, size); ctx.globalAlpha = 1;
  ctx.font = `bold ${EGEM_HEADING.fontSize}px Arial, sans-serif`;
  ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.lineJoin = "round";
  ctx.strokeStyle = EGEM_HEADING.halo; ctx.lineWidth = EGEM_HEADING.haloWidth;
  ctx.strokeText(EGEM_HEADING.text, margin, margin);
  ctx.fillStyle = EGEM_HEADING.color; ctx.fillText(EGEM_HEADING.text, margin, margin);
  const textWidth = ctx.measureText(EGEM_HEADING.text).width;
  ctx.restore();
  return { x: margin * size, y: margin * size, width: textWidth * size, height: EGEM_HEADING.fontSize * size };
}

export function waitForExportResource(promise, signal) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true; signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(signal.reason || new DOMException("Captura cancelada", "AbortError"));
    Promise.resolve(promise).then(value => finish(null, value), error => finish(error));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function prepareExportResources(prepare, controller, timeoutMs = 45000) {
  const timer = setTimeout(() => controller.abort(new Error("La capa no terminó de prepararse en 45 segundos. No se generó el PNG.")), timeoutMs);
  try { await waitForExportResource(Promise.resolve().then(() => prepare?.(controller.signal)), controller.signal); }
  finally { clearTimeout(timer); }
}

async function timedExportPhase(name, operation) {
  const start = performance.now();
  try { return await operation(); }
  finally { performance.measure(`egem:export:${name}`, { start, end: performance.now() }); }
}

export function encodePng(canvas, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("La codificación PNG no terminó a tiempo. Cierra otras tareas intensivas y vuelve a intentar.")), timeoutMs);
    try {
      canvas.toBlob(blob => {
        clearTimeout(timer);
        if (blob) resolve(blob); else reject(new Error("No se pudo codificar el PNG."));
      }, "image/png");
    } catch (error) { clearTimeout(timer); reject(error); }
  });
}

function loadExportLogo() {
  return new Promise((resolve, reject) => {
    const logo = new Image();
    const finish = (error) => {
      clearTimeout(timer);
      logo.onload = logo.onerror = null;
      if (error) reject(error); else resolve(logo);
    };
    const timer = setTimeout(() => finish(new Error("No se pudo cargar assets/encabezadoform.png a tiempo. Recarga el visor antes de exportar.")), 8000);
    logo.onload = () => finish();
    logo.onerror = () => finish(new Error("No se pudo cargar assets/encabezadoform.png. Revisa el archivo y recarga el visor."));
    logo.src = new URL("../../../assets/encabezadoform.png", import.meta.url).href;
  });
}

export function exportDate(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return {
    label: `${parts.day}/${parts.month}/${parts.year} · ${parts.hour}:${parts.minute}`,
    filename: `EGEM_Morelos_${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}.png`,
  };
}

export function metricScale(meters, pixels) {
  if (!(meters > 0) || !(pixels > 0)) throw new Error("No se pudo calcular la escala de esta vista.");
  const power = 10 ** Math.floor(Math.log10(meters));
  const distance = [5, 2, 1].map((n) => n * power).find((n) => n <= meters);
  return { pixels: pixels * distance / meters, label: distance >= 1000 ? `${distance / 1000} km` : `${Number(distance.toPrecision(3))} m` };
}

export function visibleSources(map) {
  const zoom = map.getZoom();
  return new Set((map.getStyle()?.layers || []).filter((layer) =>
    layer.source && layer.layout?.visibility !== "none" &&
    zoom >= (layer.minzoom ?? -Infinity) && zoom < (layer.maxzoom ?? Infinity) &&
    layer.paint?.[`${layer.type}-opacity`] !== 0
  ).map((layer) => layer.source));
}

// Keep failed source instances: idle alone also accepts failed tiles.
export function trackExportErrors(map) {
  const failures = new Map();
  map.on("error", (event) => {
    if (event.error?.name === "AbortError") return;
    const id = event.sourceId || event.source?.id;
    const message = event.error?.message || "Error de recurso cartográfico";
    failures.set(id || message, { id, source: id ? map.getSource(id) : null, message });
  });
  return () => {
    const visible = visibleSources(map);
    for (const failure of failures.values()) {
      if (!failure.id || (visible.has(failure.id) && map.getSource(failure.id) === failure.source)) {
        throw new Error(`No se puede exportar: ${failure.id || "recurso externo"}. ${failure.message}. Oculta la capa afectada o verifica la disponibilidad y permisos CORS del proveedor y recarga el visor.`);
      }
    }
  };
}

function cameraKey(map) {
  const center = map.getCenter();
  const canvas = map.getCanvas();
  return JSON.stringify([center.lng, center.lat, map.getZoom(), map.getBearing(), map.getPitch(), canvas.width, canvas.height, canvas.clientWidth, canvas.clientHeight]);
}

export function captureMap(map, { date, check, extraAttribution = "", baseName = "", signal, timeoutMs = 25000, logo = null, crop = null, orientation = null, thematic = null }) {
  map.stop();
  const snapshot = orientation ? captureExportOrientation({ getBearing: () => orientation.bearing, getPitch: () => orientation.pitch }) : captureExportOrientation(map);
  if (Math.abs(((map.getBearing() - snapshot.bearing + 540) % 360) - 180) > 1e-7 || Math.abs(map.getPitch() - snapshot.pitch) > 1e-7) {
    return Promise.reject(new Error("La orientación cambió antes de renderizar. Vuelve a exportar con la vista estable."));
  }
  const key = cameraKey(map);
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height || canvas.width * canvas.height > 32000000) {
    return Promise.reject(new Error("El mapa es demasiado grande o no está visible. Reduce el tamaño de la ventana e intenta de nuevo."));
  }
  const enabled = HANDLERS.filter((name) => map[name]?.isEnabled());
  enabled.forEach((name) => map[name].disable());
  return new Promise((resolve, reject) => {
    let settled = false;
    let ready = false;
    let markReady = false;
    let markImage;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      map.off("idle", idle);
      map.off("render", render);
      map.off("resize", changed);
      map.off("movestart", changed);
      signal?.removeEventListener("abort", aborted);
      enabled.forEach((name) => map[name].enable());
      if (error) reject(error); else resolve(result);
    };
    const changed = () => finish(new Error("La vista cambió durante la captura. Vuelve a guardar cuando el mapa esté estable."));
    const aborted = () => finish(new DOMException("Captura cancelada", "AbortError"));
    const idle = () => { ready = true; map.triggerRepaint(); };
    const render = () => {
      if (!ready || !markReady || settled) return;
      if (!map.loaded() || !map.areTilesLoaded()) { ready = false; return; }
      let output;
      try {
        if (key !== cameraKey(map)) { changed(); return; }
        check();
        output = document.createElement("canvas");
        output.width = crop?.width || canvas.width;
        output.height = crop?.height || canvas.height;
        const context = output.getContext("2d");
        if (!context) throw new Error("No hay memoria suficiente para generar la imagen.");
        // Must remain synchronous inside render: WebGL's buffer is transient.
        // Pixel-for-pixel copy: only discard the <= 1 CSS pixel of vertical
        // overscan needed to reconcile integer DOM height with the exact ratio.
        context.drawImage(canvas, crop?.x || 0, crop?.y || 0, output.width, output.height, 0, 0, output.width, output.height);
        context.scale(2, 2);
        const span = Math.min(100, output.width / 2 * .13);
        const ratio = canvas.width / width;
        const centerY = ((crop?.y || 0) + output.height / 2) / ratio;
        const a = map.unproject([width / 2 - span / ratio, centerY]);
        const b = map.unproject([width / 2 + span / ratio, centerY]);
        const scale = metricScale(a.distanceTo(b), span);
        const sources = map.getStyle().sources;
        const credits = [...visibleSources(map)].map((id) => sources[id]?.attribution || "");
        // Existing CARTO/OpenTopoMap metadata omits their underlying data credit.
        if (credits.some((text) => /CARTO|OpenTopoMap/.test(text))) credits.push("© OpenStreetMap contributors");
        if (credits.some((text) => /OpenTopoMap/.test(text))) credits.push("SRTM · © OpenTopoMap (CC-BY-SA)");
        credits.push(extraAttribution);
        const annotations = drawAnnotations(context, output.width / 2, output.height / 2, scale, credits, markImage, baseName);
        const heading = drawExportHeading(context, output.width / 2, output.height / 2);
        const north = drawExportNorth(context, output.width / 2, output.height / 2, snapshot);
        const legendPlacement = { annotations, heading, north, background: EXPORT_ANNOTATIONS.creditBackground };
        drawExportLegend(context, output.width / 2, output.height / 2, thematic, legendPlacement);
        finish(null, output);
      } catch (error) {
        if (output) { output.width = 0; output.height = 0; }
        finish(error);
      }
    };
    const timer = setTimeout(() => {
      try { check(); } catch (error) { finish(error); return; }
      finish(new Error("El mapa no terminó de cargar en 25 segundos. Revisa la conexión y las capas visibles antes de intentar de nuevo."));
    }, timeoutMs);
    map.on("idle", idle);
    map.on("render", render);
    map.on("resize", changed);
    map.on("movestart", changed);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    Promise.resolve(logo).then((image) => {
      if (settled) return;
      markImage = image;
      markReady = true;
      map.triggerRepaint();
    }, (error) => finish(error));
    map.triggerRepaint();
  });
}

export async function captureExpandedMap(map, options) {
  map.stop();
  const orientation = captureExportOrientation(map);
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timeout = setTimeout(() => controller.abort(new Error("La nueva extensión no terminó de cargar en 45 segundos. Revisa la conexión y las capas visibles.")), 45000);
  let scene;
  try {
    // The UI path snapshots a ready scene synchronously before its first await.
    // Later catalog selections cannot change the copied style, images or legend.
    if (!options.snapshotAtStart && options.prepare) await timedExportPhase("resources", () => waitForExportResource(options.prepare(controller.signal), controller.signal));
    options.check();
    scene = await timedExportPhase("scene", () => createExportScene(map, { signal: controller.signal, prepareSources: options.prepareSources }));
    return await timedExportPhase("render", () => captureMap(scene.map, {
      ...options, orientation, signal: controller.signal, crop: scene.crop,
      check: () => { if (!options.snapshotAtStart) options.check(); scene.check(); },
    }));
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason?.name !== "AbortError") throw controller.signal.reason;
    throw error;
  } finally {
    scene?.destroy();
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  }
}

// Coordinates are in half-resolution output pixels, independent of screen DPR.
// At narrow widths the credit block rises one row, retaining whole words and
// leaving the scale centered on the canvas (never on the remaining space).
export function annotationLayout(ctx, width, height, scale, text, logoRatio) {
  const c = EXPORT_ANNOTATIONS, { margin, gap, padding } = c;
  ctx.font = `${c.scaleFont}px Arial, sans-serif`;
  const scaleWidth = Math.max(scale.pixels, ctx.measureText(scale.label).width) + c.scaleHaloWidth;
  const scaleBox = { x: (width - scaleWidth) / 2, y: height - margin - 24, width: scaleWidth, height: 24 };
  const logoWidth = Math.min(c.logoWidth, width * c.logoFraction, scaleBox.x - gap - margin);
  const logo = { x: margin, y: height - margin - logoWidth / logoRatio, width: logoWidth, height: logoWidth / logoRatio };
  const wrap = (available, font) => {
    ctx.font = `${font}px Arial, sans-serif`;
    const lines = []; let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      if (ctx.measureText(word).width > available) return null;
      if (line && ctx.measureText(`${line} ${word}`).width > available) { lines.push(line); line = ""; }
      line += (line ? " " : "") + word;
    }
    if (line) lines.push(line);
    return lines.length <= 2 ? lines : null;
  };
  let font = c.creditFont, raised = false;
  let available = width - margin - (scaleBox.x + scaleWidth + gap) - padding * 2;
  let lines = wrap(available, font);
  if (!lines) { font = c.minCreditFont; lines = wrap(available, font); }
  if (!lines) { raised = true; font = c.creditFont; available = width - margin * 2 - padding * 2; lines = wrap(available, font); }
  if (!lines) { font = c.minCreditFont; lines = wrap(available, font); }
  if (!lines || logoWidth < 50) throw new Error("El formato es demasiado estrecho para conservar legibles la marca, escala y créditos completos.");
  const creditHeight = lines.length ? lines.length * (font + 3) + padding * 2 : 0;
  const creditWidth = lines.length ? Math.max(...lines.map(line => ctx.measureText(line).width)) + padding * 2 : 0;
  const credits = { x: width - margin - creditWidth, y: (raised ? Math.min(scaleBox.y, logo.y) - gap : height - margin) - creditHeight,
    width: creditWidth,
    height: creditHeight, font, lines };
  if (Math.min(credits.y, logo.y, scaleBox.y) < margin) throw new Error("La imagen es demasiado baja para sus anotaciones.");
  return { logo, scale: scaleBox, credits };
}

export function drawAnnotations(ctx, width, height, scale, credits, logo, baseName = "") {
  if (!logo?.naturalWidth || !logo?.naturalHeight) throw new Error("El logotipo institucional no está disponible. Recarga el visor antes de exportar.");
  const plain = html => new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/\s+/g, " ").trim();
  const items = [...new Set(credits.filter(Boolean).flatMap(value => plain(value).split(" · ")).filter(Boolean))];
  const text = [baseName, ...items].filter(Boolean).join(" · ");
  const layout = annotationLayout(ctx, width, height, scale, text, logo.naturalWidth / logo.naturalHeight);
  const c = EXPORT_ANNOTATIONS, box = layout.scale;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  // Only the PNG's alpha is composited: no card, date or reserved footer.
  ctx.save(); ctx.globalAlpha = BRAND_WATERMARK_OPACITY;
  ctx.drawImage(logo, layout.logo.x, layout.logo.y, layout.logo.width, layout.logo.height);
  ctx.restore(); ctx.globalAlpha = 1;
  const background = (rect, color) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 3); ctx.fill();
  };
  // The scale has no background: outlines follow only its glyphs and bar.
  ctx.fillStyle = "#fff"; ctx.strokeStyle = c.scaleHalo; ctx.lineWidth = c.scaleHaloWidth; ctx.lineJoin = "round";
  ctx.font = `${c.scaleFont}px Arial, sans-serif`; ctx.textAlign = "center";
  ctx.strokeText(scale.label, width / 2, box.y + 11);
  ctx.fillText(scale.label, width / 2, box.y + 11);
  const x = (width - scale.pixels) / 2, y = box.y + 22;
  ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y);
  ctx.lineTo(x + scale.pixels, y); ctx.lineTo(x + scale.pixels, y - 5);
  ctx.strokeStyle = c.scaleHalo; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
  const credit = layout.credits;
  if (credit.lines.length) {
    background(credit, c.creditBackground);
    ctx.fillStyle = "#fff"; ctx.font = `${credit.font}px Arial, sans-serif`; ctx.textAlign = "left";
    credit.lines.forEach((line, i) => ctx.fillText(line, credit.x + c.padding, credit.y + c.padding + credit.font + i * (credit.font + 3)));
  }
  ctx.restore();
  return layout;
}

export function installMapExport({ map, button, status, freeze, check, attribution, baseName = () => "", thematicSnapshot = () => null, prepareSources, prepare }) {
  const checkErrors = trackExportErrors(map);
  const logoReady = loadExportLogo();
  // Report a failed preload only when the user requests an export.
  logoReady.catch(() => {});
  let busy = false;
  const nativePicker = () => typeof window.showSaveFilePicker === "function" && window.isSecureContext;
  const hint = nativePicker()
    ? "PNG 2047 × 1576: conserva el ancho geográfico; la cobertura vertical se adapta. Puedes elegir nombre y ubicación."
    : "PNG 2047 × 1576: conserva el ancho geográfico; la cobertura vertical se adapta. Descarga con nombre sugerido.";
  button.title = `Guardar imagen del mapa. ${hint}`;
  const hintElement = document.getElementById("map-export-hint");
  if (hintElement) hintElement.textContent = hint;
  button.setAttribute("aria-describedby", hintElement?.id || status.id);
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const date = exportDate();
    const controller = new AbortController();
    let release = () => {};
    let output;
    let writable;
    let shell;
    let wasInert;
    const started = performance.now();
    try {
      checkErrors();
      const requestedCamera = cameraKey(map);
      release = freeze();
      shell = document.querySelector(".app-shell");
      wasInert = shell?.inert;
      if (shell) shell.inert = true;
      status.textContent = "Preparando PNG de la vista actual…";
      // Start the picker in the original user gesture, before any await.
      let picker = Promise.resolve(null);
      if (nativePicker()) {
        try {
          picker = window.showSaveFilePicker({
            suggestedName: date.filename, types: [{ description: "Imagen PNG", accept: { "image/png": [".png"] } }],
            excludeAcceptAllOption: true,
          });
        } catch (error) { picker = Promise.reject(error); }
      }
      const selection = picker.then((handle) => ({ handle }), (error) => {
        if (["SecurityError", "NotAllowedError", "NotSupportedError"].includes(error.name)) {
          status.textContent = "El navegador no permite elegir ubicación aquí; se usará una descarga PNG convencional.";
          return { handle: null };
        }
        controller.abort(); return { error };
      });
      const captured = (async () => {
        await timedExportPhase("resources", () => prepareExportResources(prepare, controller));
        controller.signal.throwIfAborted();
        if (cameraKey(map) !== requestedCamera) throw new Error("La vista cambió mientras se preparaba la capa. Vuelve a exportar.");
        const thematic = thematicSnapshot();
        return captureExpandedMap(map, {
          date, thematic, snapshotAtStart: true, check: () => { check(); checkErrors(); }, extraAttribution: attribution(), baseName: baseName(), signal: controller.signal, logo: logoReady, prepareSources,
        });
      })().then((canvas) => { output = canvas; return { canvas }; }, (error) => ({ error })).finally(() => {
        release(); release = () => {};
        if (shell) shell.inert = wasInert;
      });
      const [selected, result] = await Promise.all([selection, captured]);
      if (selected.error) throw selected.error;
      if (result.error) throw result.error;
      const blob = await timedExportPhase("encode", () => encodePng(output));
      if (selected.handle) {
        writable = await selected.handle.createWritable();
        await writable.write(blob);
        await writable.close();
        writable = null;
        status.textContent = "Imagen PNG guardada.";
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = date.filename;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        status.textContent = "Descarga PNG iniciada. La ubicación depende de la configuración de tu navegador.";
      }
    } catch (error) {
      if (writable) await writable.abort().catch(() => {});
      status.textContent = error.name === "AbortError" ? "Guardado cancelado." :
        error.name === "SecurityError" ? "No se pudo guardar. Un recurso o el navegador bloqueó el acceso; verifica CORS y los permisos de guardado." : error.message;
    } finally {
      controller.abort();
      release();
      if (shell) shell.inert = wasInert;
      if (output) { output.width = 0; output.height = 0; }
      busy = false; button.disabled = false;
      button.removeAttribute("aria-busy");
      performance.measure("egem:export:total", { start: started, end: performance.now() });
    }
  });
}
