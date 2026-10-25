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

export async function computeFileChecksumAsync(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
