import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV ||= "test";
process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:55432/egem_test";
process.env.JWT_SECRET ||= "dummy-jwt-secret-for-local-tests";
process.env.DEFAULT_ADMIN_EMAIL ||= "admin@example.test";
process.env.DEFAULT_ADMIN_PASSWORD ||= "dummy-password";
process.env.DEFAULT_ADMIN_NAME ||= "Admin Local";
process.env.CORS_ORIGIN ||= "http://127.0.0.1:5512";

const { app } = await import("../backend/src/app.js");
const { env } = await import("../backend/src/config/env.js");
const { prisma } = await import("../backend/src/config/database.js");
const { signAccessToken } = await import("../backend/src/shared/utils/jwt.js");
const { mapLayer } = await import("../backend/src/modules/layers/layers.service.js");
const { isLayerPubliclyAccessible } = await import("../backend/src/modules/layers/layer-public-policy.js");

const ownerToken = signAccessToken({ sub: "director-a", role: "DATA_PROVIDER" });
const otherDirectorToken = signAccessToken({ sub: "director-b", role: "DATA_PROVIDER" });
const adminToken = signAccessToken({ sub: "admin", role: "ADMIN" });

let server;
let baseUrl;
let uploadRoot;
let layers;
let originalFindMany;

test.before(async () => {
  uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egem-layer-assets-"));
  env.UPLOAD_BASE_DIR = uploadRoot;
  env.CORS_ORIGIN = ["http://127.0.0.1:5512"];
  await fs.writeFile(path.join(uploadRoot, "published.geojson"), '{"type":"FeatureCollection","features":[]}');
  await fs.writeFile(path.join(uploadRoot, "pending.geojson"), '{"type":"FeatureCollection","features":[]}');
  await fs.writeFile(path.join(uploadRoot, "rejected.geojson"), '{"type":"FeatureCollection","features":[]}');
  await fs.writeFile(path.join(uploadRoot, "deleted.geojson"), '{"type":"FeatureCollection","features":[]}');
  await fs.writeFile(path.join(uploadRoot, "not-visualizable.geojson"), '{"type":"FeatureCollection","features":[]}');
  await fs.writeFile(path.join(uploadRoot, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(path.join(uploadRoot, "blocked.exe"), "nope");

  layers = [
    buildLayer("published", "published.geojson", { status: "published" }),
    buildLayer("pending", "pending.geojson", { status: "pending_review" }),
    buildLayer("rejected", "rejected.geojson", { status: "rejected" }),
    buildLayer("deleted", "deleted.geojson", { status: "published", isDeleted: true }),
    buildLayer("not-visualizable", "not-visualizable.geojson", { status: "published", isVisualizable: false }),
    buildLayer("png", "image.png", { status: "published" }),
    buildLayer("blocked", "blocked.exe", { status: "published" }),
  ];

  originalFindMany = prisma.layer.findMany;
  prisma.layer.findMany = async () => layers;
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (originalFindMany) prisma.layer.findMany = originalFindMany;
  if (server) await new Promise((resolve) => server.close(resolve));
  if (uploadRoot) await fs.rm(uploadRoot, { recursive: true, force: true });
  await prisma.$disconnect();
});

test("middleware HTTP protege assets por estado, propietario y rol", async () => {
  const published = await requestAsset("published.geojson", { origin: "http://127.0.0.1:5512" });
  assert.equal(published.status, 200);
  assert.match(published.headers.get("content-type") || "", /json/);
  assert.equal(published.headers.get("access-control-allow-origin"), "http://127.0.0.1:5512");
  assert.equal(published.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.match(published.headers.get("cache-control") || "", /public/);
  assert.ok(published.headers.get("etag"));

  assert.equal((await requestAsset("pending.geojson")).status, 401);
  assert.equal((await requestAsset("pending.geojson", { token: ownerToken })).status, 200);
  assert.equal((await requestAsset("pending.geojson", { token: otherDirectorToken })).status, 403);
  assert.equal((await requestAsset("pending.geojson", { token: adminToken })).status, 200);

  const rejectedOwner = await requestAsset("rejected.geojson", { token: ownerToken });
  assert.equal(rejectedOwner.status, 200);
  assert.match(rejectedOwner.headers.get("cache-control") || "", /private, no-store/);

  assert.equal((await requestAsset("deleted.geojson", { token: adminToken })).status, 404);
  assert.equal((await requestAsset("not-visualizable.geojson")).status, 401);
  assert.equal((await requestAsset("not-visualizable.geojson", { token: adminToken })).status, 200);
  assert.equal((await requestAsset("missing.geojson")).status, 404);
  assert.equal((await requestAsset("published.geojson", { token: "invalid-token" })).status, 200);
  assert.equal((await requestAsset("pending.geojson", { token: "invalid-token" })).status, 401);
});

test("politica publica usa campos canonicos top-level y metadata solo como fallback legado", () => {
  assert.equal(isLayerPubliclyAccessible(buildLayer("top-allows", "published.geojson", {
    status: "published",
    isVisualizable: true,
    processingStatus: "processed",
    metadataIsVisualizable: false,
    metadataProcessingStatus: "failed",
  })), true);
  assert.equal(isLayerPubliclyAccessible(buildLayer("top-blocks", "published.geojson", {
    status: "published",
    isVisualizable: false,
    processingStatus: "failed",
    metadataIsVisualizable: true,
    metadataProcessingStatus: "processed",
  })), false);
  assert.equal(isLayerPubliclyAccessible(buildLayer("legacy", "published.geojson", {
    status: "published",
    omitTopLevelProcessingFields: true,
    metadataIsVisualizable: true,
    metadataProcessingStatus: "processed",
  })), true);
  assert.equal(isLayerPubliclyAccessible(buildLayer("bad-boolean", "published.geojson", {
    status: "published",
    isVisualizable: "true",
    processingStatus: "processed",
  })), false);
  assert.equal(isLayerPubliclyAccessible(buildLayer("bad-status", "published.geojson", {
    status: "published",
    isVisualizable: true,
    processingStatus: null,
  })), false);
});

test("middleware HTTP bloquea traversal, archivos fuera del root y MIME no permitido", async () => {
  const outside = path.join(os.tmpdir(), `egem-outside-${Date.now()}.geojson`);
  await fs.writeFile(outside, '{"type":"FeatureCollection","features":[]}');
  layers.push({
    ...buildLayer("outside", "outside.geojson", { status: "published" }),
    metadata: { properties: { processedGeojsonPath: outside, isVisualizable: true, processingStatus: "processed" } },
  });

  assert.equal((await requestAsset("../secret.geojson")).status, 404);
  assert.equal((await fetch(`${baseUrl}/uploads/%2e%2e%2fsecret.geojson`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/uploads/%252e%252e%252fsecret.geojson`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/uploads/${encodeURIComponent("..\\secret.geojson")}`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/uploads/%00.geojson`)).status, 404);
  assert.equal((await requestAsset("outside.geojson")).status, 404);
  assert.equal((await requestAsset("blocked.exe")).status, 404);

  const png = await requestAsset("image.png");
  assert.equal(png.status, 200);
  assert.match(png.headers.get("content-type") || "", /png/);

  await fs.rm(outside, { force: true });
});

test("no existe ruta estatica alternativa para saltar autorizacion de uploads", async () => {
  assert.equal((await fetch(`${baseUrl}/uploads/pending.geojson`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/v1/uploads/pending.geojson`)).status, 404);
  assert.notEqual((await fetch(`${baseUrl}/api/v1/layers/uploads/pending.geojson`)).status, 200);
});

test("mapLayer separa DTO publico de DTO owner/admin sin filtrar datos privados", () => {
  const layer = {
    id: "layer-1",
    title: "Pendiente",
    slug: "pendiente",
    description: "Demo",
    municipality: "Estado de Morelos",
    sourceType: "kmz",
    status: "pending_review",
    isDeleted: false,
    rejectedReason: null,
    approvedAt: null,
    publishedAt: null,
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
    createdById: "director-a",
    createdBy: {
      id: "director-a",
      name: "Directora <script>",
      email: "directora@example.test",
      passwordHash: "hash",
      role: { code: "DATA_PROVIDER" },
    },
    files: [{
      id: "file-1",
      originalName: "demo.kmz",
      extension: "kmz",
      mimeType: "application/vnd.google-earth.kmz",
      sizeBytes: 10,
      storagePath: "C:\\secret\\demo.kmz",
    }],
    metadata: {
      id: "metadata-1",
      properties: {
        isVisualizable: true,
        processingStatus: "processed",
        processedGeojsonPath: "/opt/egem/uploads/processed/layer.geojson",
        processedGeojsonUrl: "http://localhost:4000/uploads/processed/layer.geojson",
        rasterLegendDetection: { internal: true },
      },
      preview: null,
    },
    approvals: [],
  };

  const publicDto = mapLayer(layer, { audience: "public" });
  const publicJson = JSON.stringify(publicDto);
  assert.doesNotMatch(publicJson, /storagePath|\/opt\/|C:\\|directora@example\.test|password|hash|token|submittedBy|reviewStatus/i);
  assert.equal(publicDto.files[0].publicUrl, null);
  assert.equal(publicDto.createdBy, undefined);

  const ownerDto = mapLayer(layer, { audience: "owner", actor: { sub: "director-a", role: "DATA_PROVIDER" } });
  assert.equal(ownerDto.submittedBy.id, "director-a");
  assert.equal(ownerDto.submittedBy.name, "Directora <script>");
  assert.equal(ownerDto.submittedBy.role, "DATA_PROVIDER");
  assert.equal(ownerDto.submittedBy.email, undefined);
  assert.equal(ownerDto.reviewStatus, "pending_review");

  const adminDto = mapLayer(layer, { audience: "admin", actor: { sub: "admin", role: "ADMIN" } });
  assert.equal(adminDto.submittedBy.email, "directora@example.test");
  assert.equal(adminDto.submittedAt, layer.createdAt);
});

function buildLayer(id, fileName, overrides = {}) {
  const isVisualizable = Object.prototype.hasOwnProperty.call(overrides, "isVisualizable") ? overrides.isVisualizable : true;
  const processingStatus = Object.prototype.hasOwnProperty.call(overrides, "processingStatus")
    ? overrides.processingStatus
    : "processed";
  const layer = {
    id,
    status: overrides.status || "published",
    isDeleted: overrides.isDeleted === true,
    isVisualizable,
    processingStatus,
    createdById: overrides.createdById || "director-a",
    files: [{ storagePath: path.join(uploadRoot, fileName) }],
    metadata: {
      properties: {
        processedGeojsonPath: path.join(uploadRoot, fileName),
        isVisualizable: Object.prototype.hasOwnProperty.call(overrides, "metadataIsVisualizable")
          ? overrides.metadataIsVisualizable
          : isVisualizable,
        processingStatus: Object.prototype.hasOwnProperty.call(overrides, "metadataProcessingStatus")
          ? overrides.metadataProcessingStatus
          : processingStatus,
      },
    },
    createdBy: { id: "director-a", role: { code: "DATA_PROVIDER" } },
  };
  if (overrides.omitTopLevelProcessingFields) {
    delete layer.isVisualizable;
    delete layer.processingStatus;
  }
  return layer;
}

async function requestAsset(fileName, options = {}) {
  const headers = {};
  if (options.origin) headers.Origin = options.origin;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  return fetch(`${baseUrl}/uploads/${fileName}`, { headers });
}
