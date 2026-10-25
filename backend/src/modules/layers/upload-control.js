import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";

// Una sola carga en todos los procesos que comparten UPLOAD_BASE_DIR.
// No se borra automáticamente una reserva de un proceso caído: falla cerrado.
export async function acquireUploadSlot(uploadRoot) {
  const directory = path.resolve(uploadRoot, ".runtime");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, "layer-upload.lock");
  const token = randomUUID();
  let handle;
  try { handle = await fs.open(filename, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw Object.assign(new AppError("Hay una carga de capas en proceso. Espera a que termine antes de volver a enviar el archivo.", 503), { code: "UPLOAD_BUSY" });
  }
  try { await handle.writeFile(JSON.stringify({ token, pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() })); }
  catch (error) {
    await handle.close();
    await fs.rm(filename, { force: true });
    throw error;
  }
  await handle.close();
  let released = false;
  return async () => {
    if (released) return;
    const owner = JSON.parse(await fs.readFile(filename, "utf8"));
    if (owner.token !== token) throw new Error("La reserva de carga cambió de propietario; se conserva por seguridad.");
    await fs.unlink(filename);
    released = true;
  };
}

export async function cleanupUnregisteredFiles(req) {
  if (req.uploadPersisted) return;
  await Promise.all((req.uploadTemporaryPaths || []).map(filename => fs.rm(filename, { force: true })));
}

function runMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new AppError("La conexión se cerró antes de recibir el archivo completo.", 400));
    req.once("aborted", aborted);
    middleware(req, res, error => {
      req.removeListener("aborted", aborted);
      error ? reject(error) : resolve();
    });
  });
}

export function guardedUpload(uploadRoot, parser, validator, controller) {
  return async (req, res, next) => {
    let release, failure;
    try {
      const key = req.get("Idempotency-Key");
      if (!key) throw new AppError("Recarga el visualizador antes de subir la capa para activar la protección de reintentos.", 409);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
        throw new AppError("La clave de reintento de la carga no es válida.", 400);
      }
      release = await acquireUploadSlot(uploadRoot);
      if (req.aborted) throw new AppError("La carga fue cancelada antes de recibir el archivo.", 400);
      await runMiddleware(parser, req, res);
      await runMiddleware(validator, req, res);
      if (req.aborted || res.destroyed) throw new AppError("La carga fue cancelada antes de registrarse.", 400);
      // Tras registrar la capa se completa el trabajo aunque se cierre el cliente.
      // La reserva permanece hasta terminar, independientemente de res.close.
      await controller(req, res);
    } catch (error) { failure = error; }
    finally {
      try { await cleanupUnregisteredFiles(req); }
      catch (error) { failure ||= error; }
      try { await release?.(); }
      catch (error) { failure ||= error; }
    }
    if (failure) {
      if (failure.statusCode === 503) res.set("Retry-After", "15");
      next(failure);
    }
  };
}
