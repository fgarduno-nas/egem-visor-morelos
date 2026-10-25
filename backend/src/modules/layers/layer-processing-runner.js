import { Worker } from "node:worker_threads";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";
import { buildProcessingResult } from "./layer-processing.service.js";

export function runProcessingWorker(layer, files, task = "process") {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./layer-processing.worker.js", import.meta.url), {
      workerData: { task, layer: { id: layer.id, title: layer.title, sourceType: layer.sourceType, metadata: layer.metadata }, files },
    });
    let result, failure;
    worker.once("message", value => { result = value; });
    worker.once("error", error => { failure = error; });
    // Esperar salida también en error; no mantener el isolate anterior al admitir otra carga.
    worker.once("exit", code => {
      if (failure) reject(failure);
      else if (code === 0 && result) resolve(result);
      else reject(new Error("El proceso de conversión terminó sin resultado."));
    });
  });
}

export function summarizeUploadOffThread(files, sourceType) {
  if (!["geojson", "json"].includes(sourceType)) return Promise.resolve({ featureCount: null, geometryType: null });
  return runProcessingWorker({ sourceType }, files, "summary");
}

export async function processLayerOffThread(layer, files) {
  let result;
  try { result = await runProcessingWorker(layer, files); }
  catch (error) {
    result = buildProcessingResult({ status: "failed", message: error.message, originalFileNames: files.map(file => file.originalname) });
  }
  if (result.processingStatus === "failed") {
    const root = path.resolve(env.UPLOAD_BASE_DIR, "processed");
    const target = path.resolve(root, layer.id);
    if (path.dirname(target) !== root || target === root) throw new Error("Ruta de limpieza de procesamiento no válida.");
    await fs.rm(target, { recursive: true, force: true });
  }
  return result;
}
