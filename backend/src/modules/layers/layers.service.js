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
import { isLayerPubliclyAccessible } from "./layer-public-policy.js";

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
  const vectorLegend = parseVectorLegend(body.vectorLegend);

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
  const persistedRasterLegend = rasterLegend || processing.rasterLegend || null;
  const persistedVectorLegend = vectorLegend || processing.vectorLegend || null;
  const extractedMetadata = processing.extractedMetadata || null;
  const pointIcons = Array.isArray(processing.pointIcons) ? processing.pointIcons : [];
  const vectorSublayers = Array.isArray(processing.vectorSublayers) ? processing.vectorSublayers : [];
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
            source: created.metadata?.properties?.source || extractedMetadata?.source?.value || null,
            updatedAt: created.metadata?.properties?.updatedAt || extractedMetadata?.updatedAt?.value || null,
            scaleOrResolution: created.metadata?.properties?.scaleOrResolution || extractedMetadata?.scaleOrResolution?.value || null,
            crs: created.metadata?.properties?.crs || extractedMetadata?.crs?.value || null,
            resourceType: processing.resourceType,
            processingStatus: processing.processingStatus,
            processingMessage: processing.processingMessage,
            processedGeojsonPath: processing.processedGeojsonPath,
            processedGeojsonUrl: processing.processedGeojsonUrl,
            groundOverlays: processing.groundOverlays,
            geospatialDiagnostics: processing.diagnostics,
            extractedMetadata,
            rasterLegend: persistedRasterLegend,
            vectorLegend: persistedVectorLegend,
            vectorSublayers,
            pointIcons,
            rasterLegendDetection: processing.rasterLegendDiagnostics,
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

  return mapLayer(updated, { audience: actor.role === ROLE_CODES.ADMIN ? "admin" : "owner", actor });
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

  return layers.filter(isLayerPubliclyAccessible).map((layer) => mapLayer(layer, { audience: "public" }));
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

  return layers.map((layer) => mapLayer(layer, { audience: "admin" }));
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

  return layers.map((layer) => mapLayer(layer, { audience: "admin" }));
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

  return layers.map((layer) => mapLayer(layer, { audience: "owner", actor }));
}

export async function getLayerDetail(id, actor) {
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

  assertLayerReadable(layer, actor);
  return mapLayer(layer, { audience: actor?.role === ROLE_CODES.ADMIN ? "admin" : "owner", actor });
}

export async function getLayerGeoJson(id, actor) {
  const layer = await prisma.layer.findUnique({
    where: { id },
    include: {
      files: true,
      metadata: true,
      createdBy: { include: { role: true } },
    },
  });

  if (!layer || layer.isDeleted) {
    throw new AppError("Capa no encontrada.", 404);
  }

  assertLayerReadable(layer, actor);

  const processedGeojsonPath = layer.metadata?.properties?.processedGeojsonPath;
  if (!processedGeojsonPath) {
    throw new AppError("La capa aún no cuenta con GeoJSON procesado para visualización.", 404);
  }

  if (!fs.existsSync(processedGeojsonPath)) {
    throw new AppError("La capa aún no cuenta con GeoJSON procesado para visualización.", 404);
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

  return mapLayer(updated, { audience: actor.role === ROLE_CODES.ADMIN ? "admin" : "owner", actor });
}

export async function updateLayerRasterLegend(id, rasterLegendPayload) {
  const layer = await prisma.layer.findUnique({
    where: { id },
    include: {
      metadata: true,
      files: true,
      createdBy: { include: { role: true } },
    },
  });
  if (!layer || layer.isDeleted) {
    throw new AppError("Capa no encontrada.", 404);
  }

  const rasterLegend = parseRasterLegend(rasterLegendPayload);
  const metadataProperties = layer.metadata?.properties ?? {};
  const updated = await prisma.layer.update({
    where: { id },
    data: {
      metadata: {
        upsert: {
          create: {
            properties: {
              rasterLegend,
            },
          },
          update: {
            properties: {
              ...metadataProperties,
              rasterLegend,
            },
          },
        },
      },
    },
    include: {
      files: true,
      metadata: true,
      createdBy: { include: { role: true } },
    },
  });

  return mapLayer(updated, { audience: "admin" });
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

  return mapLayer(deleted, { audience: "admin", actor });
}

export function mapLayer(layer, options = {}) {
  const audience = options.audience || "public";
  const includeAdmin = audience === "admin";
  const includeOwner = includeAdmin || audience === "owner";
  const metadataProperties = layer.metadata?.properties ?? {};
  const {
    rasterLegendDetection,
    processedGeojsonPath,
    geospatialDiagnostics,
    ...publicMetadataProperties
  } = metadataProperties;
  const vectorLegend = metadataProperties.vectorLegend ?? buildVectorLegendPreview(metadataProperties);
  const vectorSublayers = Array.isArray(metadataProperties.vectorSublayers) ? metadataProperties.vectorSublayers : [];
  const isPublished = layer.status === LAYER_STATUS.PUBLISHED;
  const processingStatus = Object.prototype.hasOwnProperty.call(layer, "processingStatus")
    ? layer.processingStatus
    : metadataProperties.processingStatus ?? "pending";
  const isVisualizable = Object.prototype.hasOwnProperty.call(layer, "isVisualizable")
    ? layer.isVisualizable === true
    : metadataProperties.isVisualizable === true;
  const safeGroundOverlays = normalizePublicGroundOverlays(metadataProperties.groundOverlays);
  const safePointIcons = normalizePublicPointIcons(metadataProperties.pointIcons);
  const safeFiles = (layer.files ?? []).map((file) => ({
    id: file.id,
    originalName: file.originalName,
    extension: file.extension,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    publicUrl: isPublished || includeOwner ? buildPublicFileUrl(env.PUBLIC_BASE_URL, file.storagePath) : null,
  }));
  const base = {
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
    processingStatus,
    resourceType: metadataProperties.resourceType ?? inferResourceTypeFromProperties(metadataProperties),
    processedGeojsonUrl: metadataProperties.processedGeojsonUrl ?? null,
    groundOverlays: safeGroundOverlays,
    pointIcons: safePointIcons,
    rasterLegend: metadataProperties.rasterLegend ?? null,
    vectorLegend,
    vectorSublayers,
    isVisualizable,
    files: safeFiles,
    metadata: layer.metadata
      ? {
          ...layer.metadata,
          properties: {
            ...publicMetadataProperties,
            groundOverlays: safeGroundOverlays,
            pointIcons: safePointIcons,
            vectorLegend,
            vectorSublayers,
          },
        }
      : null,
    approvals: includeOwner
      ? (
      layer.approvals?.map((approval) => ({
        id: approval.id,
        fromStatus: approval.fromStatus,
        toStatus: approval.toStatus,
        note: approval.note,
        createdAt: approval.createdAt,
        actor: mapSafeUser(approval.actor, { includeEmail: includeAdmin }),
      })) ?? []
      )
      : [],
  };
  if (includeOwner) {
    base.createdBy = mapSafeUser(layer.createdBy, { includeEmail: includeAdmin });
    base.submittedBy = mapSafeUser(layer.createdBy, { includeEmail: includeAdmin });
    base.submittedAt = layer.createdAt;
    base.reviewStatus = layer.status;
  }
  return base;
}

function normalizePublicGroundOverlays(value) {
  if (!Array.isArray(value)) return [];
  return value.map((overlay) => {
    const {
      imagePath,
      sourcePath,
      internalPath,
      ...safeOverlay
    } = overlay || {};
    return safeOverlay;
  });
}

function normalizePublicPointIcons(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((icon) => {
      const {
        imagePath,
        sourceEntry,
        styles,
        ...safeIcon
      } = icon || {};
      return safeIcon;
    })
    .filter((icon) => icon.imageUrl && icon.mimeType === "image/png");
}

export function assertLayerReadable(layer, actor) {
  if (layer.status === LAYER_STATUS.PUBLISHED) return;
  if (!actor) {
    throw new AppError("Token de autenticación requerido.", 401);
  }
  if (actor.role === ROLE_CODES.ADMIN) return;
  if (actor.role === ROLE_CODES.DATA_PROVIDER && layer.createdById === actor.sub) return;
  throw new AppError("No tienes permisos para consultar esta capa.", 403);
}

function mapSafeUser(user, options = {}) {
  if (!user) {
    return {
      id: null,
      name: "Usuario no disponible",
      role: null,
    };
  }
  const safe = {
    id: user.id,
    name: normalizeOptionalText(user.name) || "Usuario no disponible",
    role: user.role?.code || null,
  };
  if (options.includeEmail && user.email) {
    safe.email = user.email;
  }
  return safe;
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
    const rawClasses = Array.isArray(parsed) ? parsed : parsed?.classes || parsed?.items;
    if (!Array.isArray(rawClasses)) return null;
    const seenColors = new Set();
    const seenOrders = new Set();
    const classes = rawClasses
      .map((item, index) => {
        const label = normalizeOptionalText(item?.label);
        const color = normalizeHexColor(item?.color);
        const order = Number.isFinite(Number(item?.order)) ? Number(item.order) : index + 1;
        if (!label || !color) {
          throw new AppError("Cada clase de la leyenda raster debe tener etiqueta y color válido.", 400);
        }
        if (seenColors.has(color)) {
          throw new AppError("La leyenda raster no puede contener colores duplicados.", 400);
        }
        if (seenOrders.has(order)) {
          throw new AppError("La leyenda raster no puede contener órdenes duplicadas.", 400);
        }
        seenColors.add(color);
        seenOrders.add(order);
        return {
          label,
          color,
          value: normalizeOptionalText(item?.value),
          min: item?.min,
          max: item?.max,
          order,
        };
      })
      .sort((a, b) => a.order - b.order)
      .slice(0, 24);
    return classes.length
      ? {
          type: "raster",
          field: normalizeOptionalText(parsed?.field || parsed?.title || parsed?.name) || "Simbología raster",
          classes,
        }
      : null;
  } catch (_error) {
    if (_error instanceof AppError) throw _error;
    return null;
  }
}

function parseVectorLegend(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const rawClasses = Array.isArray(parsed) ? parsed : parsed?.classes || parsed?.items;
    if (!Array.isArray(rawClasses)) return null;
    const seenSignatures = new Set();
    const classes = rawClasses
      .map((item, index) => {
        const label = normalizeOptionalText(item?.originalLabel) || normalizeOptionalText(item?.label);
        const color = normalizeHexColor(item?.originalColor) || normalizeHexColor(item?.color);
        const sourceOrder = Number.isFinite(Number(item?.sourceOrder ?? item?.order)) ? Number(item.sourceOrder ?? item.order) : null;
        if (!label || !color) {
          throw new AppError("Cada clase de la leyenda vectorial debe tener etiqueta y color válido.", 400);
        }
        const signature = buildVectorLegendClassIdentity(item, parsed);
        if (seenSignatures.has(signature)) return null;
        seenSignatures.add(signature);
        return {
          label,
          displayLabel: normalizeOptionalText(item?.displayLabel) || label,
          originalLabel: label,
          color,
          originalColor: color,
          displayColor: normalizeHexColor(item?.displayColor) || color,
          value: normalizeOptionalText(item?.value),
          originalValue: normalizeOptionalText(item?.originalValue) || normalizeOptionalText(item?.value),
          min: item?.min,
          max: item?.max,
          sourceOrder,
          order: sourceOrder ?? index + 1,
          group: normalizeOptionalText(item?.group),
          folder: normalizeOptionalText(item?.folder),
          styleUrl: normalizeOptionalText(item?.styleUrl),
          styleId: normalizeOptionalText(item?.styleId),
          iconHref: normalizeSafeIconReference(item?.iconHref),
          symbolType: normalizeOptionalText(item?.symbolType),
          geometryRole: normalizeOptionalText(item?.geometryRole),
          legendField: normalizeOptionalText(item?.legendField),
          __sourceIndex: index,
          __identity: signature,
        };
      })
      .filter(Boolean)
      .slice(0, 24);
    const normalizedClasses = normalizeVectorLegendClassOrders(classes, parsed);
    return classes.length
      ? {
          type: parsed?.type === "continuous" ? "continuous" : "categorical",
          field: normalizeOptionalText(parsed?.field || parsed?.title || parsed?.name) || "Intensidad",
          styleField: normalizeOptionalText(parsed?.styleField) || normalizeOptionalText(parsed?.field) || "Intensidad",
          classes: normalizedClasses,
        }
      : null;
  } catch (_error) {
    if (_error instanceof AppError) throw _error;
    return null;
  }
}

function normalizeVectorLegendClassOrders(classes, legend = {}) {
  const groups = new Map();
  classes.forEach((item) => {
    const groupKey = buildVectorLegendOrderGroupKey(item, legend);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        index: groups.size,
        items: [],
        ordinal: isOrdinalVectorLegendGroup(item, legend),
      });
    }
    groups.get(groupKey).items.push(item);
  });

  return [...groups.values()].flatMap((group) => {
    const sorted = [...group.items].sort((a, b) => compareVectorLegendOrder(a, b, group.ordinal));
    return sorted.map((item, index) => {
      const displayOrder = index + 1;
      const {
        __sourceIndex: _sourceIndex,
        __identity: _identity,
        ...publicItem
      } = item;
      return {
        ...publicItem,
        sourceOrder: item.sourceOrder,
        displayOrder,
        order: displayOrder,
      };
    });
  });
}

function buildVectorLegendOrderGroupKey(item, legend = {}) {
  return [
    item?.group || item?.folder || "sin-grupo",
    item?.legendField || legend?.styleField || legend?.field || "sin-campo",
  ].map(normalizeLegendIdentityPart).join("|");
}

function compareVectorLegendOrder(a, b, useOrdinalOrder = false) {
  if (useOrdinalOrder) {
    const ordinalA = getSemanticVectorLegendOrder(a?.originalValue || a?.value || a?.label);
    const ordinalB = getSemanticVectorLegendOrder(b?.originalValue || b?.value || b?.label);
    if (ordinalA !== ordinalB) return ordinalA - ordinalB;
  }
  const orderA = Number.isFinite(Number(a?.sourceOrder)) ? Number(a.sourceOrder) : Number.POSITIVE_INFINITY;
  const orderB = Number.isFinite(Number(b?.sourceOrder)) ? Number(b.sourceOrder) : Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  if (a.__sourceIndex !== b.__sourceIndex) return a.__sourceIndex - b.__sourceIndex;
  const valueCompare = normalizeLegendIdentityPart(a?.originalValue || a?.value || a?.label)
    .localeCompare(normalizeLegendIdentityPart(b?.originalValue || b?.value || b?.label), "es");
  if (valueCompare) return valueCompare;
  const styleCompare = normalizeLegendIdentityPart(a?.styleId || a?.styleUrl)
    .localeCompare(normalizeLegendIdentityPart(b?.styleId || b?.styleUrl), "es");
  if (styleCompare) return styleCompare;
  return normalizeLegendIdentityPart(a?.__identity).localeCompare(normalizeLegendIdentityPart(b?.__identity), "es");
}

function isOrdinalVectorLegendGroup(item, legend = {}) {
  const text = [
    item?.group,
    item?.folder,
    item?.legendField,
    legend?.styleField,
    legend?.field,
  ].map(normalizeLegendIdentityPart).join(" ");
  return /\b(intensidad|intensid|peligro|amenaza|descarga)/u.test(text);
}

function getSemanticVectorLegendOrder(value) {
  const order = new Map([
    ["muy alto", 1],
    ["muy alta", 1],
    ["alto", 2],
    ["alta", 2],
    ["medio", 3],
    ["media", 3],
    ["bajo", 4],
    ["baja", 4],
    ["muy bajo", 5],
    ["muy baja", 5],
  ]);
  return order.get(normalizeLegendIdentityPart(value).replace(/\s+/gu, " ").trim()) ?? Number.POSITIVE_INFINITY;
}

function buildVectorLegendClassIdentity(item, legend = {}) {
  const technicalParts = [
    item?.group || item?.folder,
    item?.legendField || legend?.styleField || legend?.field,
    item?.originalValue || item?.value,
    item?.styleId || item?.styleUrl,
    item?.symbolType,
    item?.geometryRole,
    item?.iconHref,
  ].map((value) => normalizeLegendIdentityPart(value));
  if (!technicalParts.some(Boolean)) {
    technicalParts.push(normalizeLegendIdentityPart(item?.label || item?.displayLabel));
  }
  return technicalParts.join("|");
}

function normalizeLegendIdentityPart(value) {
  return normalizeOptionalText(value)?.toLowerCase() || "";
}

function normalizeSafeIconReference(value) {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(text)) return null;
  if (text.includes("..") || text.includes("\\") || text.startsWith("/")) return null;
  return text.slice(0, 240);
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
      const color =
        normalizeHexColor(featureProperties.__styleFill) ||
        normalizeHexColor(featureProperties.__styleIcon) ||
        normalizeHexColor(featureProperties.__styleLine) ||
        getInstitutionalPreviewColor(label);
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

    const legend = classes.length
      ? {
          type: "categorical",
          field: getVectorLegendPreviewField(classes, features),
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
    properties.Intensid_1,
    properties.Intensidad_1,
    properties.Peligro,
    properties.peligro,
    properties.Nivel,
    properties.nivel,
    properties.Clase,
    properties.clase,
    getHtmlDescriptionAttribute(properties.Description || properties.description, "Intensidad"),
    getHtmlDescriptionAttribute(properties.Description || properties.description, "Intensid_1"),
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

function getVectorLegendPreviewField(classes, features = []) {
  const concept = getDominantVectorLegendConcept(features);
  if (concept) return concept;
  return classes.some((item) => getVectorLegendPreviewOrder(item.label) < 100)
    ? "Intensidad"
    : "Estilo";
}

function getDominantVectorLegendConcept(features = []) {
  const counts = new Map();
  features.forEach((feature) => {
    const properties = feature?.properties || {};
    const description = properties.Description || properties.description;
    const value =
      normalizeOptionalText(properties.R_P_V_E_A) ||
      normalizeOptionalText(properties.Indicador) ||
      getHtmlDescriptionAttribute(description, "R_P_V_E_A") ||
      getHtmlDescriptionAttribute(description, "Indicador");
    if (!value) return;
    const normalized = value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (!["peligro", "riesgo", "susceptibilidad", "intensidad"].includes(normalized)) return;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  });

  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return dominant ? dominant.charAt(0).toUpperCase() + dominant.slice(1) : null;
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
