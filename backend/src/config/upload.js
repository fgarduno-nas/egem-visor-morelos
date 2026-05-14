import fs from "node:fs";
import path from "node:path";
import multer from "multer";

import { env } from "./env.js";
import { AppError } from "../shared/errors/app-error.js";

const allowedExtensions = new Set([
  ".kml",
  ".kmz",
  ".geojson",
  ".zip",
  ".tif",
  ".tiff",
  ".shp",
  ".dbf",
  ".prj",
  ".cpg",
]);

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildStoragePath(req, file) {
  const today = new Date();
  const year = String(today.getFullYear());
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const userId = req.user?.sub ?? "anonymous";
  const targetDir = path.join(env.UPLOAD_BASE_DIR, year, month, day, userId);

  ensureDirectory(targetDir);

  const timestamp = Date.now();
  const normalizedName = file.originalname.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
  return {
    targetDir,
    filename: `${timestamp}-${normalizedName}`,
  };
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const { targetDir } = buildStoragePath(req, file);
    cb(null, targetDir);
  },
  filename(req, file, cb) {
    const { filename } = buildStoragePath(req, file);
    cb(null, filename);
  },
});

function fileFilter(_req, file, cb) {
  const extension = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    return cb(new AppError("Extensión de archivo no permitida.", 400));
  }
  return cb(null, true);
}

export const upload = multer({
  storage,
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: 10,
  },
  fileFilter,
});
