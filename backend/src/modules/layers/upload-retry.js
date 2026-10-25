import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";

export function uploadFingerprint(body, files) {
  const sorted = Object.fromEntries(Object.keys(body).sort().map(key => [key, body[key]]));
  return createHash("sha256").update(JSON.stringify({ body: sorted, files: files.map(file => [file.originalname, file.size, file.checksum]) })).digest("hex");
}

export async function findUploadRetry(prisma, actorId, requestId, fingerprint) {
  if (!requestId) return null;
  const previous = await prisma.layer.findFirst({
    where: { createdById: actorId, metadata: { is: { properties: { path: ["uploadRequestId"], equals: requestId } } } },
    include: { files: true, metadata: true, createdBy: { include: { role: true } } },
  });
  if (previous && (previous.isDeleted || previous.metadata.properties.uploadFingerprint !== fingerprint)) {
    throw new AppError("La clave de reintento ya corresponde a otra carga. Selecciona el archivo de nuevo para iniciar una carga distinta.", 409);
  }
  return previous;
}
