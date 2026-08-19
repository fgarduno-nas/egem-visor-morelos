import fs from "node:fs";
import path from "node:path";
import slugify from "slugify";

import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { createAuditLog } from "../../shared/services/audit.service.js";
import { LAYER_STATUS } from "../../shared/constants/layer-status.js";
import { ROLE_CODES } from "../../shared/constants/roles.js";
import {
  buildPublicFileUrl,
  computeFileChecksum,
  getFileExtension,
} from "../../shared/utils/file-utils.js";
import { getRequestMetadata } from "../../shared/utils/request-metadata.js";
import { processUploadedLayer } from "./layer-processing.service.js";

const vectorLegendPreviewCache = new Map();

export async function uploadLayer({ body, files, actor, req }) {
  if (!files?.length) {
    throw new AppError("Debes adjuntar al menos un archivo.", 400);
  }

  const slugBase = slugify(body.title, { lower: true, strict: true });
  const slug = `${slugBase}-${Date.now()}`;
  const sourceType = path.extname(files[0].originalname).replace(".", "").toLowerCase();
  const status =
    actor.role === ROLE_CODES.ADMIN ? LAYER_STATUS.APPROVED : LAYER_STATUS.PENDING_REVIEW;
  const institutionalMetadata = buildInstitutionalMetadata(body, files, sourceType);
  const rasterLegend = parseRasterLegend(body.rasterLegend);

  const created = await prisma.layer.create({
    data: {
      title: body.title,
      slug,
      description: body.description ?? null,
      municipality: body.municipality ?? actor.municipality ?? null,
      sourceType,
      status,
      createdById: actor.sub,
      metadata: {
        create: {
          featureCount: institutionalMetadata.featureCount,
          geometryType: institutionalMetadata.geometryType,
          crs: institutionalMetadata.crs,
          properties: institutionalMetadata.properties,
        },
      },
      files: {
        create: files.map((file) => ({
          originalName: file.originalname,
          storedName: file.filename,
          storagePath: file.path,
          mimeType: file.mimetype || "application/octet-stream",
          extension: getFileExtension(file.originalname).replace(".", ""),
          sizeBytes: file.size,
          checksum: computeFileChecksum(file.path),
          uploadedById: actor.sub,
        })),
      },
    },
    include: {
      files: true,
      metadata: true,
      createdBy: {
        include: { role: true },
      },
    },
  });
  const processing = await processUploadedLayer(created, files);
  const updated = await prisma.layer.update({
    where: { id: created.id },
    data: {
      metadata: {
        update: {
          featureCount: processing.featureCount ?? created.metadata?.featureCount,
          geometryType: processing.geometryType ?? created.metadata?.geometryType,
          bbox: processing.bbox,
          crs: processing.crs ?? created.metadata?.crs,
          preview: processing.isVisualizable
            ? {
                type: processing.resourceType || "vector",
                url: processing.processedGeojsonUrl,
                groundOverlays: processing.groundOverlays,
              }
            : null,
          properties: {
            ...(created.metadata?.properties ?? {}),
            resourceType: processing.resourceType,
            processingStatus: processing.processingStatus,
            processingMessage: processing.processingMessage,
            processedGeojsonPath: processing.processedGeojsonPath,
            processedGeojsonUrl: processing.processedGeojsonUrl,
            groundOverlays: processing.groundOverlays,
            geospatialDiagnostics: processing.diagnostics,
            rasterLegend,
            isVisualizable: processing.isVisualizable,
            originalFileNames: processing.originalFileNames,
          },
        },
      },
    },
    include: {
      files: true,
      metadata: true,
      createdBy: {
        include: { role: true },
      },
    },
  });

  const requestInfo = getRequestMetadata(req);
  await createAuditLog({
    actorId: actor.sub,
    entityType: "Layer",
    entityId: updated.id,
    action: "LAYER_CREATED",
    description: `Capa ${updated.title} creada.`,
    metadata: { status: updated.status, processingStatus: processing.processingStatus },
    ipAddress: requestInfo.ipAddress,
    userAgent: requestInfo.userAgent,
  });

  return mapLayer(updated);
}

export async function listPublicLayers() {
  const layers = await prisma.layer.findMany({
    where: {
      isDeleted: false,
      status: LAYER_STATUS.PUBLISHED,
    },
    include: {
      files: true,
      metadata: true,
      createdBy: { include: { role: true } },
    },
    orderBy: { publishedAt: "desc" },
  });

  return layers.map(mapLayer);
}

export async function listPendingLayers() {
  const layers = await prisma.layer.findMany({
    where: {
      isDeleted: false,
      status: LAYER_STATUS.PENDING_REVIEW,
    },
    include: {
      files: true,
      metadata: true,
      createdBy: { include: { role: true } },
      approvals: {
        include: { actor: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return layers.map(mapLayer);
}

export async function listAdminLayers() {
  const layers = await prisma.layer.findMany({
    where: {
      isDeleted: false,
    },
    include: {
      files: true,
      metadata: true,
      createdBy: { include: { role: true } },
      approvals: {
        include: { actor: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return layers.map(mapLayer);
}

export function listLayersForUser(actor) {
  if (actor.role === ROLE_CODES.ADMIN) {
    return listAdminLayers();
  }

  if (actor.role === ROLE_CODES.DATA_PROVIDER) {
    return listOwnLayers(actor);
  }

  return listPublicLayers();
}

export async function listOwnLayers(actor) {
  const layers = await prisma.layer.findMany({
    where: {
      isDeleted: false,
      createdById: actor.sub,
    },
    include: {
      files: true,
      metadata: true,
      createdBy: { include: { role: true } },
      approvals: {
        include: { actor: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return layers.map(mapLayer);
}

export async function getLayerDetail(id) {
  const layer = await prisma.layer.findUnique({
    where: { id },
    include: {
      files: true,
      metadata: true,
      createdBy: { include: { role: true } },
      approvals: {
        include: { actor: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!layer || layer.isDeleted) {
    throw new AppError("Capa no encontrada.", 404);
  }

  return mapLayer(layer);
}

export async function getLayerGeoJson(id) {
  const layer = await prisma.layer.findUnique({
    where: { id },
    include: {
      files: true,
      metadata: true,
    },
  });

  if (!layer || layer.isDeleted) {
    throw new AppError("Capa no encontrada.", 404);
  }

  const processedGeojsonPath = layer.metadata?.properties?.processedGeojsonPath;
  if (!processedGeojsonPath) {
    throw new AppError("La capa aÃºn no cuenta con GeoJSON procesado para visualizaciÃ³n.", 404);
  }

  if (!fs.existsSync(processedGeojsonPath)) {
    throw new AppError("La capa aÃºn no cuenta con GeoJSON procesado para visualizaciÃ³n.", 404);
  }

  try {
    const raw = fs.readFileSync(processedGeojsonPath, "utf8");
    return JSON.parse(raw);
  } catch (_error) {
    throw new AppError("No se pudo leer el GeoJSON procesado de la capa.", 500);
  }
}

async function changeLayerStatus({ id, actor, req, toStatus, reason = null, description, action }) {
  const layer = await prisma.layer.findUnique({
    where: { id },
  });

  if (!layer || layer.isDeleted) {
    throw new AppError("Capa no encontrada.", 404);
  }

  if (
    toStatus === LAYER_STATUS.PUBLISHED &&
    ![LAYER_STATUS.APPROVED, LAYER_STATUS.UNPUBLISHED, LAYER_STATUS.PUBLISHED].includes(layer.status)
  ) {
    throw new AppError("La capa debe estar aprobada antes de publicarse.", 409);
  }

  const updated = await prisma.layer.update({
    where: { id },
    data: {
      status: toStatus,
      rejectedReason: toStatus === LAYER_STATUS.REJECTED ? reason : null,
      approvedAt: toStatus === LAYER_STATUS.APPROVED ? new Date() : layer.approvedAt,
      publishedAt: toStatus === LAYER_STATUS.PUBLISHED ? new Date() : toStatus === LAYER_STATUS.UNPUBLISHED ? null : layer.publishedAt,
      approvals: {
        create: {
          actorId: actor.sub,
          fromStatus: layer.status,
          toStatus,
          note: reason,
        },
      },
    },
    include: {
      files: true,
      metadata: true,
      createdBy: { include: { role: true } },
      approvals: {
        include: { actor: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const requestInfo = getRequestMetadata(req);
  await createAuditLog({
    actorId: actor.sub,
    entityType: "Layer",
    entityId: updated.id,
    action,
    description,
    metadata: {
      fromStatus: layer.status,
      toStatus,
      reason,
    },
    ipAddress: requestInfo.ipAddress,
    userAgent: requestInfo.userAgent,
  });

  return mapLayer(updated);
}

export function approveLayer(id, actor, req) {
  return changeLayerStatus({
    id,
    actor,
    req,
    toStatus: LAYER_STATUS.APPROVED,
    description: "Capa aprobada.",
    action: "LAYER_APPROVED",
  });
}

export function rejectLayer(id, reason, actor, req) {
  return changeLayerStatus({
    id,
    actor,
    req,
    toStatus: LAYER_STATUS.REJECTED,
    reason,
    description: "Capa rechazada.",
    action: "LAYER_REJECTED",
  });
}

export function publishLayer(id, status, actor, req) {
  return changeLayerStatus({
    id,
    actor,
    req,
    toStatus: status,
    description: status === LAYER_STATUS.PUBLISHED ? "Capa publicada." : "Capa despublicada.",
    action: status === LAYER_STATUS.PUBLISHED ? "LAYER_PUBLISHED" : "LAYER_UNPUBLISHED",
  });
}

export async function deleteLayer(id, actor, req) {
  const layer = await prisma.layer.findUnique({ where: { id } });
  if (!layer || layer.isDeleted) {
    throw new AppError("Capa no encontrada.", 404);
  }

  const deleted = await prisma.layer.update({
    where: { id },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
    },
    include: {
      files: true,
      metadata: true,
      createdBy: { include: { role: true } },
    },
  });

  const requestInfo = getRequestMetadata(req);
  await createAuditLog({
    actorId: actor.sub,
    entityType: "Layer",
    entityId: deleted.id,
    action: "LAYER_DELETED",
    description: "Capa eliminada lógicamente.",
    ipAddress: requestInfo.ipAddress,
    userAgent: requestInfo.userAgent,
  });

  return mapLayer(deleted);
}

function mapLayer(layer) {
  const metadataProperties = layer.metadata?.properties ?? {};
  const vectorLegend = metadataProperties.vectorLegend ?? buildVectorLegendPreview(metadataProperties);
  return {
    id: layer.id,
    title: layer.title,
    slug: layer.slug,
    description: layer.description,
    municipality: layer.municipality,
    sourceType: layer.sourceType,
    status: layer.status,
    isDeleted: layer.isDeleted,
    rejectedReason: layer.rejectedReason,
    approvedAt: layer.approvedAt,
    publishedAt: layer.publishedAt,
    createdAt: layer.createdAt,
    updatedAt: layer.updatedAt,
    processingStatus: metadataProperties.processingStatus ?? "pending",
    resourceType: metadataProperties.resourceType ?? inferResourceTypeFromProperties(metadataProperties),
    processedGeojsonUrl: metadataProperties.processedGeojsonUrl ?? null,
    groundOverlays: metadataProperties.groundOverlays ?? [],
    rasterLegend: metadataProperties.rasterLegend ?? null,
    vectorLegend,
    isVisualizable: Boolean(metadataProperties.isVisualizable),
    createdBy: layer.createdBy
      ? {
          id: layer.createdBy.id,
          name: layer.createdBy.name,
          email: layer.createdBy.email,
          role: layer.createdBy.role.code,
        }
      : null,
    files: (layer.files ?? []).map((file) => ({
      id: file.id,
      originalName: file.originalName,
      extension: file.extension,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      storagePath: file.storagePath,
      publicUrl: buildPublicFileUrl(env.PUBLIC_BASE_URL, file.storagePath),
    })),
    metadata: layer.metadata
      ? {
          ...layer.metadata,
          properties: {
            ...metadataProperties,
            vectorLegend,
          },
        }
      : null,
    approvals:
      layer.approvals?.map((approval) => ({
        id: approval.id,
        fromStatus: approval.fromStatus,
        toStatus: approval.toStatus,
        note: approval.note,
        createdAt: approval.createdAt,
        actor: approval.actor
          ? {
              id: approval.actor.id,
              name: approval.actor.name,
              email: approval.actor.email,
            }
          : null,
      })) ?? [],
  };
}

function buildInstitutionalMetadata(body, files, sourceType) {
  const geoJsonSummary = summarizeGeoJsonUpload(files[0], sourceType);
  const geometryType = geoJsonSummary.geometryType || inferGeometryTypeFromSource(sourceType);
  const uploadedFileNames = files.map((file) => file.originalname);

  return {
    featureCount: geoJsonSummary.featureCount,
    geometryType,
    crs: normalizeOptionalText(body.crs) || "EPSG:4326",
    properties: {
      tags: body.tags ?? [],
      source: normalizeOptionalText(body.source),
      responsibleAgency: normalizeOptionalText(body.responsibleAgency),
      updatedAt: normalizeOptionalText(body.updatedAt),
      scaleOrResolution: normalizeOptionalText(body.scaleOrResolution),
      crs: normalizeOptionalText(body.crs) || "EPSG:4326",
      geometryType,
      featureCount: geoJsonSummary.featureCount,
      coverage: normalizeOptionalText(body.municipality),
      originalFileNames: uploadedFileNames,
      supportedFormatsNote:
        "GeoJSON se visualiza directamente; KML/KMZ se analiza por contenido real y puede procesarse como vector, GroundOverlay raster o mixto. Shapefile ZIP se procesa a GeoJSON cuando GDAL/ogr2ogr esta disponible. GeoTIFF queda registrado para procesamiento raster posterior.",
    },
  };
}

function parseRasterLegend(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return null;
    const classes = parsed
      .map((item, index) => ({
        label: normalizeOptionalText(item?.label),
        color: normalizeHexColor(item?.color),
        order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
      }))
      .filter((item) => item.label && item.color)
      .sort((a, b) => a.order - b.order)
      .slice(0, 24);
    return classes.length
      ? {
          type: "raster",
          field: "Simbologia raster",
          classes,
        }
      : null;
  } catch (_error) {
    return null;
  }
}

function buildVectorLegendPreview(properties = {}) {
  if (properties.resourceType === "ground-overlay") return null;
  const processedGeojsonPath = resolveProcessedGeojsonPath(properties.processedGeojsonPath);
  if (!processedGeojsonPath || !fs.existsSync(processedGeojsonPath)) return null;

  try {
    const stats = fs.statSync(processedGeojsonPath);
    const cacheKey = `${processedGeojsonPath}:${stats.mtimeMs}:${stats.size}`;
    if (vectorLegendPreviewCache.has(cacheKey)) {
      return vectorLegendPreviewCache.get(cacheKey);
    }

    const raw = fs.readFileSync(processedGeojsonPath, "utf8");
    const parsed = JSON.parse(raw);
    const features = Array.isArray(parsed.features) ? parsed.features : [];
    const classesByColor = new Map();

    features.forEach((feature) => {
      const featureProperties = feature?.properties || {};
      const label = getVectorLegendPreviewLabel(featureProperties);
      const color = getInstitutionalPreviewColor(label) || normalizeHexColor(featureProperties.__styleFill);
      if (!color) return;
      if (!classesByColor.has(color)) {
        classesByColor.set(color, {
          color,
          labels: new Map(),
          order: getVectorLegendPreviewOrder(label),
        });
      }
      const entry = classesByColor.get(color);
      entry.labels.set(label, (entry.labels.get(label) || 0) + 1);
      entry.order = Math.min(entry.order, getVectorLegendPreviewOrder(label));
    });

    const classes = [...classesByColor.values()]
      .map((entry) => ({
        label: [...entry.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Simbolo de la capa",
        color: entry.color,
        outlineColor: "#f0f0f0",
        order: entry.order,
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "es"))
      .slice(0, 24);

    const legend = classes.length > 1
      ? {
          type: "categorical",
          field: getVectorLegendPreviewField(classes),
          classes,
        }
      : null;
    vectorLegendPreviewCache.clear();
    vectorLegendPreviewCache.set(cacheKey, legend);
    return legend;
  } catch (error) {
    console.warn("No se pudo construir la leyenda vectorial de catalogo.", error.message);
    return null;
  }
}

function resolveProcessedGeojsonPath(value) {
  const rawPath = normalizeOptionalText(value);
  if (!rawPath) return null;
  if (path.isAbsolute(rawPath)) return rawPath;
  const candidates = [
    path.resolve(process.cwd(), rawPath),
    path.resolve(process.cwd(), "..", rawPath),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function getInstitutionalPreviewColor(label) {
  const normalized = String(label || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const colors = {
    "muy baja": "#006100",
    "muy bajo": "#006100",
    baja: "#7aab00",
    bajo: "#7aab00",
    media: "#ffff00",
    medio: "#ffff00",
    alta: "#ff9900",
    alto: "#ff9900",
    "muy alta": "#ff2200",
    "muy alto": "#ff2200",
  };
  return colors[normalized] || null;
}

function getVectorLegendPreviewLabel(properties = {}) {
  const candidates = [
    properties.Intensidad,
    properties.intensidad,
    properties.Nivel,
    properties.nivel,
    properties.Clase,
    properties.clase,
    getHtmlDescriptionAttribute(properties.Description || properties.description, "Intensidad"),
    properties.Name,
    properties.name,
  ];
  const value = candidates.find((candidate) => normalizeOptionalText(candidate));
  return normalizeOptionalText(value) || "Simbolo de la capa";
}

function getHtmlDescriptionAttribute(description, fieldName) {
  const html = normalizeOptionalText(description);
  if (!html) return null;
  const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<td[^>]*>\\s*${escapedField}\\s*<\\/td>\\s*<td[^>]*>\\s*([^<]+)\\s*<\\/td>`, "iu");
  const match = pattern.exec(html);
  return match?.[1] ? normalizeOptionalText(match[1]) : null;
}

function getVectorLegendPreviewOrder(label) {
  const normalized = String(label || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const order = new Map([
    ["muy baja", 1],
    ["muy bajo", 1],
    ["baja", 2],
    ["bajo", 2],
    ["media", 3],
    ["medio", 3],
    ["alta", 4],
    ["alto", 4],
    ["muy alta", 5],
    ["muy alto", 5],
  ]);
  return order.get(normalized) ?? 100;
}

function getVectorLegendPreviewField(classes) {
  return classes.some((item) => getVectorLegendPreviewOrder(item.label) < 100)
    ? "Intensidad"
    : "Estilo";
}

function normalizeHexColor(value) {
  const normalized = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : null;
}

function inferResourceTypeFromProperties(properties) {
  if (Array.isArray(properties.groundOverlays) && properties.groundOverlays.length && properties.processedGeojsonUrl) {
    return "mixed";
  }
  if (Array.isArray(properties.groundOverlays) && properties.groundOverlays.length) {
    return "ground-overlay";
  }
  return "vector";
}

function summarizeGeoJsonUpload(file, sourceType) {
  if (!["geojson", "json"].includes(String(sourceType || "").toLowerCase())) {
    return { featureCount: null, geometryType: null };
  }

  try {
    const raw = fs.readFileSync(file.path, "utf8");
    const parsed = JSON.parse(raw);
    const features =
      parsed.type === "FeatureCollection"
        ? parsed.features || []
        : parsed.type === "Feature"
          ? [parsed]
          : [];
    const geometryTypes = new Set(
      features.map((feature) => feature.geometry?.type).filter(Boolean)
    );

    return {
      featureCount: features.length,
      geometryType: geometryTypes.size ? [...geometryTypes].join(", ") : "Vector GeoJSON",
    };
  } catch (_error) {
    return { featureCount: null, geometryType: "Vector GeoJSON" };
  }
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function inferGeometryTypeFromSource(sourceType) {
  const normalized = String(sourceType || "").toLowerCase();
  if (normalized === "geojson" || normalized === "json") return "Vector";
  if (normalized === "zip" || normalized === "shp") return "Vector shapefile";
  if (normalized === "kml" || normalized === "kmz") return "Vector KML";
  if (normalized === "tif" || normalized === "tiff") return "Raster GeoTIFF";
  return "No especificado";
}
