const HANDLERS = ["scrollZoom", "boxZoom", "dragRotate", "dragPan", "keyboard", "doubleClickZoom", "touchZoomRotate", "touchPitch"];
import { createExportScene } from "./map-export-renderer.js";
const LOGO_OPACITY = 1;

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

export function captureMap(map, { date, check, extraAttribution = "", signal, timeoutMs = 25000, logo = null, crop = null }) {
  map.stop();
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
        const span = 100;
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
        drawAnnotations(context, output.width / 2, output.height / 2, date.label, scale, credits, markImage);
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
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timeout = setTimeout(() => controller.abort(new Error("La nueva extensión no terminó de cargar en 45 segundos. Revisa la conexión y las capas visibles.")), 45000);
  let scene;
  try {
    options.check();
    scene = await createExportScene(map, { signal: controller.signal, prepareSources: options.prepareSources });
    return await captureMap(scene.map, {
      ...options, signal: controller.signal, crop: scene.crop,
      check: () => { options.check(); scene.check(); },
    });
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason?.name !== "AbortError") throw controller.signal.reason;
    throw error;
  } finally {
    scene?.destroy();
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  }
}

function drawAnnotations(ctx, width, height, date, scale, credits, logo) {
  if (!logo?.naturalWidth || !logo?.naturalHeight) throw new Error("El logotipo institucional no está disponible. Recarga el visor antes de exportar.");
  const plain = (html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent.replace(/\s+/g, " ").trim();
  };
  const text = [...new Set(credits.filter(Boolean).map(plain))].join(" · ");
  const logoWidth = Math.min(340, width - 36);
  const maxCreditWidth = Math.max(150, Math.min(540, width - logoWidth - 58));
  ctx.font = "11px Arial, sans-serif";
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && ctx.measureText(`${line} ${word}`).width > maxCreditWidth - 16) { lines.push(line); line = ""; }
    line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  const creditHeight = lines.length ? lines.length * 14 + 8 : 0;
  const x = 10;
  const logoHeight = logoWidth * logo.naturalHeight / logo.naturalWidth;
  const stacked = logoWidth < 300;
  const cardHeight = logoHeight + (stacked ? 61 : 44);
  const y = height - cardHeight - 12;
  if (y < 10 || width < 225) throw new Error("Amplía el área del mapa para que la marca y las atribuciones sean legibles.");
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.fillRect(x, y, logoWidth + 16, cardHeight);
  ctx.save();
  ctx.globalAlpha = LOGO_OPACITY;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(logo, x + 8, y + 8, logoWidth, logoHeight);
  ctx.restore();
  ctx.fillStyle = "#17312d";
  ctx.font = "11px Arial, sans-serif";
  const footerY = y + 8 + logoHeight + 14;
  const scaleX = stacked ? x + 8 : x + 8 + logoWidth - 112;
  const scaleY = footerY + (stacked ? 17 : 0);
  ctx.fillText(date, x + 8, footerY);
  ctx.fillText(scale.label, scaleX, scaleY);
  ctx.strokeStyle = "#17312d";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(scaleX, scaleY + 5); ctx.lineTo(scaleX, scaleY + 10);
  ctx.lineTo(scaleX + scale.pixels, scaleY + 10); ctx.lineTo(scaleX + scale.pixels, scaleY + 5);
  ctx.stroke();
  if (creditHeight) {
    const creditWidth = Math.max(...lines.map(value => ctx.measureText(value).width)) + 16;
    const creditX = width - creditWidth - 10;
    const creditY = height - creditHeight - 12;
    ctx.fillStyle = "rgba(24, 28, 27, 0.78)";
    ctx.fillRect(creditX, creditY, creditWidth, creditHeight);
    ctx.fillStyle = "#ffffff";
    lines.forEach((value, index) => ctx.fillText(value, creditX + 8, creditY + 14 + index * 14));
  }
}

export function installMapExport({ map, button, status, freeze, check, attribution, prepareSources }) {
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
    try {
      check(); checkErrors();
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
      const captured = captureExpandedMap(map, {
        date, check: () => { check(); checkErrors(); }, extraAttribution: attribution(), signal: controller.signal, logo: logoReady, prepareSources,
      }).then((canvas) => { output = canvas; return { canvas }; }, (error) => ({ error })).finally(() => {
        release(); release = () => {};
        if (shell) shell.inert = wasInert;
      });
      const [selected, result] = await Promise.all([selection, captured]);
      if (selected.error) throw selected.error;
      if (result.error) throw result.error;
      const blob = await new Promise((resolve, reject) => {
        output.toBlob((value) => value ? resolve(value) : reject(new Error("No se pudo codificar el PNG.")), "image/png");
      });
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
    }
  });
}
