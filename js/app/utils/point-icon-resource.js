import { normalizeHexColor } from "./color-utils.js";

/** Bounded, shared PNG loads. Cache only decoded pixels; never cache errors. */
export function createPointIconLoader({ fetchImage = (...args) => fetch(...args), decode = decodePointIcon,
  timeoutMs = 6500, cacheSize = 64, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  const entries = new Map();
  return function load(url, { signal, timeoutMs: deadline = timeoutMs } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    let entry = entries.get(url);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, users: 0, settled: false };
      entries.set(url, entry);
      entry.promise = new Promise((resolve, reject) => {
        let done = false, stage = 'http', timer;
        const finish = (error, image) => {
          if (done) return;
          done = true; entry.settled = true;
          unschedule(timer); controller.signal.removeEventListener('abort', aborted);
          if (error) { if (entries.get(url) === entry) entries.delete(url); reject(error); }
          else {
            resolve(image);
            for (const [key, value] of entries) {
              if (entries.size <= cacheSize) break;
              if (value.settled) entries.delete(key);
            }
          }
        };
        const aborted = () => finish(controller.signal.reason);
        controller.signal.addEventListener('abort', aborted, { once: true });
        timer = schedule(() => {
          const error = new Error(`El icono excedió ${deadline} ms en ${stage}: ${url}`);
          error.stage = stage; controller.abort(error);
        }, deadline);
        (async () => {
          const response = await fetchImage(url, { signal: controller.signal });
          controller.signal.throwIfAborted();
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
          stage = 'body'; const blob = await response.blob();
          controller.signal.throwIfAborted();
          stage = 'decode'; const image = await decode(blob, controller.signal);
          controller.signal.throwIfAborted();
          if (!image?.width || !image?.height || image.data?.length !== image.width * image.height * 4) throw new Error(`PNG inválido: ${url}`);
          finish(null, image);
        })().catch(error => { if (!error.stage) error.stage = stage; finish(error); });
      });
    }
    entry.users++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, image) => {
        if (done) return;
        done = true; signal?.removeEventListener('abort', aborted); entry.users--;
        if (!entry.users && !entry.settled) {
          if (entries.get(url) === entry) entries.delete(url);
          entry.controller.abort(new DOMException('Carga sustituida', 'AbortError'));
        }
        if (error) reject(error); else resolve(image);
      };
      const aborted = () => finish(signal.reason);
      signal?.addEventListener('abort', aborted, { once: true });
      entry.promise.then(image => finish(null, image), error => finish(error));
      if (signal?.aborted) aborted();
    });
  };
}

export async function decodePointIcon(blob, signal) {
  // ImageBitmap has no cancellation API: always close even a late decode.
  const bitmap = await createImageBitmap(blob);
  try {
    signal.throwIfAborted();
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: pixels.width, height: pixels.height, data: new Uint8Array(pixels.data) };
  } finally { bitmap.close(); }
}

export function canonicalPointSymbol(item = {}, properties = {}) {
  const role = String(item.geometryRole || item.folder || item.group || properties.__geometryRole || properties.__kmlFolder || item.originalLabel || item.label || '').toLowerCase();
  const shape = role.includes('manantial') ? 'dot' : role.includes('pozo') ? 'triangle' : null;
  if (!shape) return null; // Unknown icons must not become invented generic symbols.
  const color = [item.displayColor, item.originalColor, item.color, '#7a203a'].map(value => normalizeHexColor(value)).find(Boolean);
  return { shape, color };
}
