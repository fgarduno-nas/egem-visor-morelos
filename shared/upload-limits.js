export const MAX_UPLOAD_SIZE_MB = 50;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
export const UPLOAD_LIMIT_LABEL = `${MAX_UPLOAD_SIZE_MB} MB`;
export const UPLOAD_SIZE_ERROR = `El archivo supera el tamaño máximo permitido de ${UPLOAD_LIMIT_LABEL}.`;

export function validateUploadSizes(files) {
  if (Array.from(files).some((file) => file.size > MAX_UPLOAD_BYTES)) {
    const error = new Error(UPLOAD_SIZE_ERROR);
    error.code = "LIMIT_FILE_SIZE";
    throw error;
  }
}

export const MAX_UPLOAD_FILES = 1;
export const UPLOAD_FILE_COUNT_ERROR = "Selecciona un solo archivo por carga. Para shapefile, usa un ZIP con sus componentes.";
export function validateUploadFileCount(files) {
  if (Array.from(files).length > MAX_UPLOAD_FILES) throw new Error(UPLOAD_FILE_COUNT_ERROR);
}
