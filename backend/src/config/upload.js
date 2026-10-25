import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from "../../../shared/upload-limits.js";

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
    filename: `${timestamp}-${randomUUID()}-${normalizedName}`,
  };
}

const storage = {
  _handleFile(req, file, cb) {
    const { targetDir, filename } = buildStoragePath(req, file);
    const target = path.join(targetDir, filename);
    (req.uploadTemporaryPaths ||= []).push(target);
    const output = fs.createWriteStream(target, { flags: "wx" });
    const abort = () => output.destroy(new Error("Recepción de archivo cancelada."));
    req.once("aborted", abort);
    pipeline(file.stream, output, error => {
      req.removeListener("aborted", abort);
      if (error) return fs.rm(target, { force: true }, () => cb(error));
      cb(null, { destination: targetDir, filename, path: target, size: output.bytesWritten });
    });
  },
  _removeFile(_req, file, cb) {
    fs.rm(file.path, { force: true }, cb);
  },
};

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
    // Busboy marca truncado al alcanzar el límite, incluso sin bytes adicionales.
    // El byte centinela permite exactamente MAX_UPLOAD_BYTES y rechaza desde +1.
    fileSize: MAX_UPLOAD_BYTES + 1,
    files: MAX_UPLOAD_FILES,
  },
  fileFilter,
});
