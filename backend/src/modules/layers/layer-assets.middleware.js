import fs from "node:fs";
import path from "node:path";

import { env } from "../../config/env.js";
import { prisma } from "../../config/database.js";
import { ROLE_CODES } from "../../shared/constants/roles.js";
import { verifyAccessToken } from "../../shared/utils/jwt.js";
import { isLayerPubliclyAccessible } from "./layer-public-policy.js";

const PRIVATE_CACHE_CONTROL = "private, no-store";
const PUBLIC_CACHE_CONTROL = "public, max-age=3600";
const ALLOWED_ASSET_EXTENSIONS = new Set([
  ".geojson",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".kml",
  ".kmz",
  ".zip",
]);

export async function serveLayerAsset(req, res, next) {
  try {
    const relativePath = decodeURIComponent(req.params[0] || "");
    const filePath = resolveUploadPath(relativePath);
    if (!filePath || !isAllowedAssetFile(filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).json({ success: false, message: "Recurso no encontrado." });
    }

    const layer = await findLayerByAssetPath(filePath);
    if (!layer || layer.isDeleted) {
      return res.status(404).json({ success: false, message: "Recurso no encontrado." });
    }

    const isPublic = isLayerAssetPublic(layer);
    if (!isPublic) {
      const actor = readOptionalActor(req);
      if (!actor) {
        return res.status(401).json({ success: false, message: "Token de autenticación requerido." });
      }
      if (!canAccessPrivateLayer(layer, actor)) {
        return res.status(403).json({ success: false, message: "No tienes permisos para este recurso." });
      }
    }

    res.setHeader("Cache-Control", isPublic ? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL);
    res.sendFile(filePath);
  } catch (_error) {
    return res.status(404).json({ success: false, message: "Recurso no encontrado." });
  }
}

function resolveUploadPath(relativePath) {
  if (!relativePath || relativePath.includes("\0")) return null;
  if (hasTraversalSegment(relativePath)) return null;
  const uploadRoot = path.resolve(env.UPLOAD_BASE_DIR);
  const normalized = path.normalize(relativePath);
  if (hasTraversalSegment(normalized)) return null;
  const candidate = path.resolve(uploadRoot, normalized);
  if (candidate !== uploadRoot && !candidate.startsWith(`${uploadRoot}${path.sep}`)) return null;
  return candidate;
}

function hasTraversalSegment(value) {
  return String(value)
    .split(/[\\/]+/)
    .some((segment) => segment === "..");
}

function isAllowedAssetFile(filePath) {
  return ALLOWED_ASSET_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export const isLayerAssetPublic = isLayerPubliclyAccessible;

async function findLayerByAssetPath(filePath) {
  const normalized = normalizePath(filePath);
  const layers = await prisma.layer.findMany({
    where: { isDeleted: false },
    include: {
      files: true,
      metadata: true,
      createdBy: { include: { role: true } },
    },
  });

  return layers.find((layer) => {
    const fileMatch = (layer.files || []).some((file) => normalizePath(file.storagePath) === normalized);
    if (fileMatch) return true;
    const properties = layer.metadata?.properties || {};
    if (normalizePath(properties.processedGeojsonPath) === normalized) return true;
    const overlayMatch = (properties.groundOverlays || []).some((overlay) => normalizePath(overlay.imagePath) === normalized);
    if (overlayMatch) return true;
    return (properties.pointIcons || []).some((icon) => normalizePath(icon.imagePath) === normalized);
  }) || null;
}

function readOptionalActor(req) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  try {
    return verifyAccessToken(authorization.replace("Bearer ", "").trim());
  } catch (_error) {
    return null;
  }
}

function canAccessPrivateLayer(layer, actor) {
  if (actor.role === ROLE_CODES.ADMIN) return true;
  if (actor.role === ROLE_CODES.DATA_PROVIDER && layer.createdById === actor.sub) return true;
  return false;
}

function normalizePath(value) {
  return value ? path.resolve(String(value)).replace(/\\/g, "/") : "";
}
