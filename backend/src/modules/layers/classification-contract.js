// Bridge release uses 0 (read-only uploads); final release uses 1 after migration.
export const CLASSIFICATION_CONTRACT_VERSION = 1;

export function classificationContractController(_req, res) {
  res.set('Cache-Control', 'no-store');
  return res.json({ success: true, data: { version: CLASSIFICATION_CONTRACT_VERSION } });
}

export function requireClassificationContract(req, res, next) {
  if (CLASSIFICATION_CONTRACT_VERSION === 0) {
    return res.status(503).json({ success: false, message: 'La clasificación de capas se está actualizando. La consulta sigue disponible; intenta subir la capa después de la actualización.' });
  }
  if (req.get('X-EGEM-Classification-Version') !== String(CLASSIFICATION_CONTRACT_VERSION)) {
    return res.status(409).json({ success: false, message: 'Esta versión del visualizador no puede enviar la nueva clasificación. Recarga la página y selecciona la sección antes de volver a subir la capa.' });
  }
  return next();
}
