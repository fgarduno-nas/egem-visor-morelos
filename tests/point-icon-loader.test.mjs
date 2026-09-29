import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { waitForExportResource, encodePng } from "../js/app/utils/map-export.js";

test("PNG encoding preserves the result and bounds a missing callback", async () => {
  const blob = new Blob(["png"], { type: "image/png" });
  assert.equal(await encodePng({ toBlob(callback, type) { assert.equal(type, "image/png"); callback(blob); } }), blob);
  await assert.rejects(encodePng({ toBlob() {} }, 5), /codificación PNG/);
  await assert.rejects(encodePng({ toBlob(callback) { callback(null); } }), /codificar/);
});

const source = fs.readFileSync(new URL("../js/map.js", import.meta.url), "utf8");
const loaderSource = source.slice(source.indexOf("  function loadMapImage("), source.indexOf("  function applyPointIconFeatureIds("));
const loader = map => new Function("map", "POINT_ICON_LOAD_TIMEOUT_MS", `${loaderSource}; return loadMapImage;`)(map, 30);

test("MapLibre 4.7 Promise response.data resolves without an obsolete callback", async () => {
  const image = { width: 6, height: 6 };
  const load = loader({ loadImage: async url => { assert.equal(url, "icon.png"); return { data: image }; } });
  assert.equal(await load("icon.png"), image);
});

test("real HTTP/CORS failures are preserved rather than replaced with timeout or fallback", async () => {
  const error = new Error("HTTP 403 icon.png");
  await assert.rejects(loader({ loadImage: async () => { throw error; } })("icon.png"), e => e === error);
  await assert.rejects(loader({ loadImage: async () => ({ data: null }) })("icon.png"), /No se pudo cargar/);
});

test("a hung icon is bounded and late rejection is consumed", async () => {
  let rejectLate;
  await assert.rejects(loader({ loadImage: () => new Promise((_, reject) => { rejectLate = reject; }) })("slow.png", { timeoutMs: 5 }), /segundos/);
  rejectLate(new Error("late network error"));
  await new Promise(resolve => setTimeout(resolve, 0));
});

test("export preparation can be cancelled even when its pending resource never resolves", async () => {
  const controller = new AbortController();
  const pending = waitForExportResource(new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("an already cancelled export consumes a concurrent resource failure", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(waitForExportResource(Promise.reject(new Error("resource failed")), controller.signal), { name: "AbortError" });
});
