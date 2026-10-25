import { parentPort, workerData } from "node:worker_threads";
import { processUploadedLayer, summarizeGeoJsonUpload } from "./layer-processing.service.js";

parentPort.postMessage(workerData.task === "summary"
  ? summarizeGeoJsonUpload(workerData.files[0], workerData.layer.sourceType)
  : await processUploadedLayer(workerData.layer, workerData.files));
parentPort.close();
