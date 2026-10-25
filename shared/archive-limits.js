import { MAX_UPLOAD_BYTES, UPLOAD_SIZE_ERROR, UPLOAD_LIMIT_LABEL } from "./upload-limits.js";

export const ARCHIVE_LIMITS = Object.freeze({
  maxCompressedBytes: MAX_UPLOAD_BYTES,
  maxSingleEntryBytes: 128 * 1024 * 1024,
  maxUncompressedBytes: 450 * 1024 * 1024,
  maxArchiveEntries: 250,
  maxCompressionRatio: 100,
});

const mib = (bytes) => `${bytes / (1024 * 1024)} MiB`;

// Presupuesto de la vista previa XML/DOM; no es un límite de aceptación del servidor.
export const MAX_CLIENT_KML_PREVIEW_BYTES = 32 * 1024 * 1024;
export const SERVER_PREVIEW_MESSAGE = "El KML supera los 32 MiB para la vista previa en este navegador. El archivo se conserva: completa su clasificación y envíalo para procesarlo en el servidor. Podrás visualizarlo desde el catálogo cuando termine el procesamiento.";

export function archiveEntrySizeError(name, limits = ARCHIVE_LIMITS) {
  return new Error(`La entrada interna «${name}» supera el límite de ${mib(limits.maxSingleEntryBytes)} descomprimidos por entrada. El límite de ${UPLOAD_LIMIT_LABEL} corresponde al archivo comprimido.`);
}

export function validateArchiveSizes(entries, { compressedSize, limits = ARCHIVE_LIMITS } = {}) {
  if (compressedSize > limits.maxCompressedBytes) throw new Error(UPLOAD_SIZE_ERROR);
  if (!entries.length) throw new Error("El archivo comprimido no contiene entradas legibles.");
  if (entries.length > limits.maxArchiveEntries) {
    throw new Error(`El archivo comprimido supera el máximo de ${limits.maxArchiveEntries} entradas.`);
  }
  let compressedTotal = 0;
  let uncompressedTotal = 0;
  for (const entry of entries) {
    const compressed = Number(entry.compressedSize ?? 0);
    const uncompressed = Number(entry.uncompressedSize ?? 0);
    if (![compressed, uncompressed].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error("El archivo comprimido contiene tamaños internos inválidos.");
    }
    if (uncompressed > limits.maxSingleEntryBytes) throw archiveEntrySizeError(entry.name, limits);
    compressedTotal += compressed;
    uncompressedTotal += uncompressed;
    if (uncompressedTotal > limits.maxUncompressedBytes) {
      throw new Error(`El contenido descomprimido total supera el límite de ${mib(limits.maxUncompressedBytes)}.`);
    }
    if (uncompressed > compressed * limits.maxCompressionRatio) {
      throw new Error(`La entrada interna «${entry.name}» supera la relación máxima de compresión de ${limits.maxCompressionRatio}:1. No se descomprimirá por seguridad.`);
    }
  }
  if (compressedTotal > limits.maxCompressedBytes) throw new Error(UPLOAD_SIZE_ERROR);
}
