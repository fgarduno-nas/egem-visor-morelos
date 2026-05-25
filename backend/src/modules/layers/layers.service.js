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

export async function uploadLayer({ body, files, actor, req }) {
  if (!files?.length) {
    throw new AppError("Debes adjuntar al menos un archivo.", 400);
  }

  const slugBase = slugify(body.title, { lower: true, strict: true });
  const slug = `${slugBase}-${Date.now()}`;
  const status =
    actor.role === ROLE_CODES.ADMIN ? LAYER_STATUS.APPROVED : LAYER_STATUS.PENDING_REVIEW;

  const created = await prisma.layer.create({
    data: {
      title: body.title,
      slug,
      description: body.description ?? null,
      municipality: body.municipality ?? actor.municipality ?? null,
      sourceType: path.extname(files[0].originalname).replace(".", "").toLowerCase(),
      status,
      createdById: actor.sub,
      metadata: {
        create: {
          properties: {
            tags: body.tags ?? [],
          },
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

  const requestInfo = getRequestMetadata(req);
  await createAuditLog({
    actorId: actor.sub,
    entityType: "Layer",
    entityId: created.id,
    action: "LAYER_CREATED",
    description: `Capa ${created.title} creada.`,
    metadata: { status: created.status },
    ipAddress: requestInfo.ipAddress,
    userAgent: requestInfo.userAgent,
  });

  return mapLayer(created);
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

async function changeLayerStatus({ id, actor, req, toStatus, reason = null, description, action }) {
  const layer = await prisma.layer.findUnique({
    where: { id },
  });

  if (!layer || layer.isDeleted) {
    throw new AppError("Capa no encontrada.", 404);
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
    metadata: layer.metadata ?? null,
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
