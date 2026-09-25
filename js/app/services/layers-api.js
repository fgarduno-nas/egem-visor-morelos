import { runtimeConfig } from "../config/runtime-config.js";
import { invalidateCache, request } from "./http-client.js";

export const LAYER_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export async function listPublicLayersRequest() {
  const payload = await request("/layers/public", {
    cacheTtlMs: runtimeConfig.publicLayerCacheTtlMs,
    cacheKey: "GET:/layers/public",
  });

  if (!Array.isArray(payload?.data)) {
    const error = new Error("La API devolvio una respuesta de capas incompleta.");
    error.code = "INVALID_LAYER_RESPONSE";
    error.payload = payload;
    throw error;
  }

  return payload.data;
}

export async function listPendingLayersRequest(token) {
  const payload = await request("/layers/admin/pending", {
    token,
    cacheTtlMs: 10000,
    cacheKey: "GET:/layers/admin/pending",
  });

  return payload?.data ?? [];
}

export async function listAdminLayersRequest(token) {
  const payload = await request("/layers/admin/manageable", {
    token,
    cacheTtlMs: 10000,
    cacheKey: "GET:/layers/admin/manageable",
  });

  return payload?.data ?? [];
}

export async function listMyLayersRequest(token) {
  const payload = await request("/layers/mine", {
    token,
    cacheTtlMs: 10000,
    cacheKey: "GET:/layers/mine",
  });

  return payload?.data ?? [];
}

export function getUploadResourceType(metadata = {}) {
  return String(metadata.resourceType || metadata.previewResourceType || metadata.sourceKind || "")
    .trim()
    .toLowerCase();
}

export function uploadHasGroundOverlays(metadata = {}) {
  return Array.isArray(metadata.groundOverlays) && metadata.groundOverlays.length > 0;
}

export function shouldSendRasterLegend(metadata = {}) {
  const resourceType = getUploadResourceType(metadata);
  return Boolean(
    metadata.rasterLegend &&
    (resourceType === "ground-overlay" || resourceType === "raster" || resourceType === "mixed" || uploadHasGroundOverlays(metadata))
  );
}

export function shouldSendVectorLegend(metadata = {}) {
  const resourceType = getUploadResourceType(metadata);
  return Boolean(metadata.vectorLegend && resourceType !== "ground-overlay" && resourceType !== "raster");
}

export function buildLayerUploadFormData(metadata, files) {
  const formData = new FormData();
  formData.append("title", metadata.title);
  formData.append("description", metadata.description || "");
  formData.append("municipality", metadata.municipality || "");
  formData.append("source", metadata.source || "");
  formData.append("responsibleAgency", metadata.responsibleAgency || "");
  formData.append("updatedAt", metadata.updatedAt || "");
  formData.append("scaleOrResolution", metadata.scaleOrResolution || "");
  formData.append("crs", metadata.crs || "");
  if (shouldSendRasterLegend(metadata)) {
    formData.append("rasterLegend", JSON.stringify(metadata.rasterLegend));
  }
  if (shouldSendVectorLegend(metadata)) {
    formData.append("vectorLegend", JSON.stringify(metadata.vectorLegend));
  }

  (metadata.tags || []).forEach((tag) => formData.append("tags", tag));
  files.forEach((file) => formData.append("files", file));

  return formData;
}

export async function uploadLayerRequest(token, metadata, files) {
  const formData = buildLayerUploadFormData(metadata, files);

  const payload = await request("/layers", {
    method: "POST",
    token,
    body: formData,
    timeoutMs: LAYER_UPLOAD_TIMEOUT_MS,
    retries: 0,
  });

  invalidateCache("/layers");
  return payload?.data ?? null;
}

export async function approveLayerRequest(token, layerId) {
  const payload = await request(`/layers/${layerId}/approve`, {
    method: "PATCH",
    token,
    body: {},
    retries: 0,
  });

  invalidateCache("/layers");
  return payload?.data ?? null;
}

export async function rejectLayerRequest(token, layerId, reason) {
  const payload = await request(`/layers/${layerId}/reject`, {
    method: "PATCH",
    token,
    body: { reason },
    retries: 0,
  });

  invalidateCache("/layers");
  return payload?.data ?? null;
}

export async function setPublishStateRequest(token, layerId, status) {
  const payload = await request(`/layers/${layerId}/publish-state`, {
    method: "PATCH",
    token,
    body: { status },
    retries: 0,
  });

  invalidateCache("/layers");
  return payload?.data ?? null;
}

export async function deleteLayerRequest(token, layerId) {
  const payload = await request(`/layers/${layerId}`, {
    method: "DELETE",
    token,
    retries: 0,
  });

  invalidateCache("/layers");
  return payload?.data ?? null;
}
