import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";

export function getFileExtension(filename) {
  return path.extname(filename).toLowerCase();
}

export function buildPublicFileUrl(publicBaseUrl, storagePath) {
  const normalized = storagePath.replace(/\\/g, "/");
  return `${publicBaseUrl}/${normalized}`;
}

export function computeFileChecksum(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}
