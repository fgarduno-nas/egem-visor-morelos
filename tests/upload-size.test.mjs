import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { MAX_UPLOAD_BYTES, UPLOAD_SIZE_ERROR, validateUploadSizes, MAX_UPLOAD_FILES, UPLOAD_FILE_COUNT_ERROR, validateUploadFileCount } from "../shared/upload-limits.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "egem-upload-size-"));
process.env.MAX_UPLOAD_SIZE_MB = "50";
process.env.UPLOAD_BASE_DIR = root;
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test-only-not-a-production-secret";
process.env.DEFAULT_ADMIN_EMAIL = "test@example.com";
process.env.DEFAULT_ADMIN_PASSWORD = "test-only-password";
process.env.DEFAULT_ADMIN_NAME = "Test upload";
const require = createRequire(new URL("../backend/package.json", import.meta.url));
const express = require("express");
const { upload } = await import("../backend/src/config/upload.js");
const { errorMiddleware } = await import("../backend/src/middlewares/error.middleware.js");
globalThis.window = { __EGEM_CONFIG__: {}, location: { hostname: "localhost" } };
const { uploadLayerRequest } = await import("../js/app/services/layers-api.js");

test("validación compartida: máximo inclusivo y cada archivo individual", () => {
  for (const size of [MAX_UPLOAD_BYTES - 1, MAX_UPLOAD_BYTES]) {
    assert.doesNotThrow(() => validateUploadSizes([{ size }, { size }]));
  }
  assert.throws(() => validateUploadSizes([{ size: 1 }, { size: MAX_UPLOAD_BYTES + 1 }]), { message: UPLOAD_SIZE_ERROR });
});

test("servicio: rechaza antes de solicitar contrato o enviar bytes", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail("No debe hacer solicitudes");
  try {
    await assert.rejects(uploadLayerRequest("test", {}, [{ size: MAX_UPLOAD_BYTES + 1 }]), { message: UPLOAD_SIZE_ERROR });
  } finally { globalThis.fetch = original; }
});

test("interfaz: el error de tamaño no se sustituye por una carga anterior ni una consulta fallida", async () => {
  const source = fs.readFileSync(new URL("../js/map.js", import.meta.url), "utf8");
  const start = source.indexOf("  async function buildUploadErrorMessage(error) {");
  const end = source.indexOf("  async function findRecentlySavedUploadDraftLayer()", start);
  const buildMessage = new Function("UPLOAD_SIZE_ERROR", "findRecentlySavedUploadDraftLayer", `${source.slice(start, end)}; return buildUploadErrorMessage;`)(
    UPLOAD_SIZE_ERROR, () => assert.fail("Un rechazo por tamaño no consulta cargas anteriores")
  );
  assert.equal(await buildMessage({ status: 413 }), UPLOAD_SIZE_ERROR);
  assert.equal(await buildMessage({ code: "LIMIT_FILE_SIZE" }), UPLOAD_SIZE_ERROR);
});

for (const [status, body] of [[413, "<html>Request Entity Too Large</html>"], [400, JSON.stringify({ code: "LIMIT_FILE_SIZE", message: "File too large" })]]) {
  test(`servicio: mensaje claro para rechazo ${status}`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (_url, options) => options.method === "GET"
      ? new Response(JSON.stringify({ data: { version: 1 } }))
      : new Response(body, { status });
    try {
      await assert.rejects(uploadLayerRequest("test", { title: "Prueba", tags: [] }, []), { message: UPLOAD_SIZE_ERROR, status });
    } finally { globalThis.fetch = original; }
  });
}

test("recepción multipart real: -1, máximo, +1 y limpieza de todos los temporales", async () => {
  const app = express();
  app.post("/upload", upload.array("files", MAX_UPLOAD_FILES), (req, res) => res.json(req.files.map(({ size }) => size)));
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    for (const size of [MAX_UPLOAD_BYTES - 1, MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES + 1]) {
      // GeoJSON sintácticamente válido con espacio final: prueba del transporte,
      // no evidencia del procesamiento de una capa cartográfica grande.
      const bytes = Buffer.alloc(size, 32);
      bytes.write('{"type":"FeatureCollection","features":[]}');
      const form = new FormData();
      form.append("files", new Blob([bytes]), "limite.geojson");
      const response = await fetch(`http://127.0.0.1:${server.address().port}/upload`, { method: "POST", body: form });
      const payload = await response.json();
      assert.equal(response.status, size > MAX_UPLOAD_BYTES ? 413 : 200);
      if (size <= MAX_UPLOAD_BYTES) {
        assert.equal(payload[0], size);
        for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
          if (entry.isFile()) fs.unlinkSync(path.join(entry.parentPath, entry.name));
        }
      } else {
        assert.equal(payload.message, UPLOAD_SIZE_ERROR);
        assert.equal(payload.code, "LIMIT_FILE_SIZE");
      }
      assert.equal(fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).length, 0);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("una sola capa: rechaza dos archivos antes de enviar y en multipart real", async () => {
  assert.throws(() => validateUploadFileCount([{}, {}]), { message: UPLOAD_FILE_COUNT_ERROR });
  await assert.rejects(uploadLayerRequest("test", {}, [{ size: 1 }, { size: 1 }]), { message: UPLOAD_FILE_COUNT_ERROR });
  const app = express();
  app.post("/upload", upload.array("files", MAX_UPLOAD_FILES), (_req, res) => res.sendStatus(200));
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const form = new FormData();
    for (const name of ["uno.geojson", "dos.geojson"]) form.append("files", new Blob(["{}"]), name);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/upload`, { method: "POST", body: form });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, UPLOAD_FILE_COUNT_ERROR);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
});
