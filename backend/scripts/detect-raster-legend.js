import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  analyzeKmzFile,
  extractGroundOverlayImages,
} from "../src/modules/layers/geospatial-importer.service.js";
import { detectRasterLegendForGroundOverlays } from "../src/modules/layers/raster-legend-detector.service.js";

const args = new Set(process.argv.slice(2));
const layerId = readArgValue("--id");
const filePath = readArgValue("--file");
const title = readArgValue("--title") || (filePath ? path.basename(filePath) : null);
const apply = args.has("--apply");
const allowProduction = args.has("--allow-production");

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

if ((!layerId && !filePath) || (layerId && filePath)) {
  printHelp();
  process.exit(1);
}

try {
  if (filePath) {
    await analyzeLocalKmzFile(filePath, { title });
  } else {
    await analyzeStoredLayer(layerId, { title, apply, allowProduction });
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function analyzeLocalKmzFile(inputPath, options = {}) {
  const resolvedPath = path.resolve(inputPath);
  if (!fs.existsSync(resolvedPath)) throw new Error(`Archivo no encontrado: ${inputPath}`);
  const outputRoot = path.join(os.tmpdir(), "egem-raster-legend-script");
  const layerKey = `diagnostic-${Date.now()}`;
  const analysis = analyzeKmzFile(resolvedPath);
  const overlays = extractGroundOverlayImages({
    archivePath: resolvedPath,
    layerId: layerKey,
    overlays: analysis.groundOverlays.filter((overlay) => overlay.isValid && overlay.imageEntry),
    outputRoot,
    publicBaseUrl: "http://localhost:4000",
  });

  try {
    const detection = await detectRasterLegendForGroundOverlays(overlays, {
      title: options.title || path.basename(resolvedPath),
      fileName: path.basename(resolvedPath),
    });
    printJson({
      mode: "file",
      applied: false,
      fileName: path.basename(resolvedPath),
      kind: analysis.kind,
      confidence: detection.diagnostics?.confidence || "low",
      rasterLegend: detection.rasterLegend,
      diagnostics: detection.diagnostics,
    });
  } finally {
    fs.rmSync(path.join(outputRoot, "processed", layerKey), { recursive: true, force: true });
  }
}

async function analyzeStoredLayer(id, options = {}) {
  process.env.NODE_ENV ??= "development";
  if (process.env.NODE_ENV === "production" && !options.allowProduction) {
    throw new Error("Operacion bloqueada en NODE_ENV=production. Usa --allow-production solo si estas seguro.");
  }

  const { prisma } = await import("../src/config/database.js");
  try {
    const layer = await prisma.layer.findUnique({
      where: { id },
      include: { metadata: true },
    });

    if (!layer || layer.isDeleted) throw new Error(`Capa no encontrada: ${id}`);
    const properties = layer.metadata?.properties || {};
    if (hasValidManualRasterLegend(properties.rasterLegend)) {
      printJson({
        mode: "id",
        layerId: id,
        applied: false,
        reason: "La capa ya tiene una rasterLegend valida no automatica; no se sobrescribe.",
      });
      return;
    }

    const overlays = Array.isArray(properties.groundOverlays) ? properties.groundOverlays : [];
    const detection = await detectRasterLegendForGroundOverlays(overlays, {
      title: options.title || layer.title,
      name: layer.title,
      metadata: properties,
    });

    if (!options.apply || !detection.rasterLegend) {
      printJson({
        mode: "id",
        layerId: id,
        applied: false,
        dryRun: !options.apply,
        confidence: detection.diagnostics?.confidence || "low",
        rasterLegend: detection.rasterLegend,
        diagnostics: detection.diagnostics,
      });
      return;
    }

    await prisma.layer.update({
      where: { id },
      data: {
        metadata: {
          update: {
            properties: {
              ...properties,
              rasterLegend: detection.rasterLegend,
              rasterLegendDetection: detection.diagnostics,
            },
          },
        },
      },
    });

    printJson({
      mode: "id",
      layerId: id,
      applied: true,
      confidence: detection.diagnostics?.confidence || "low",
      classCount: detection.rasterLegend.classes.length,
    });
  } finally {
    await prisma.$disconnect();
  }
}

function printHelp() {
  console.log(`Uso:
  node backend/scripts/detect-raster-legend.js --file <ruta.kmz> [--title <titulo>]
  node backend/scripts/detect-raster-legend.js --id <layerId> [--apply] [--allow-production]

Notas:
  --file analiza un KMZ local en modo diagnostico sin base de datos ni escritura.
  --id analiza una capa existente por ID; por defecto es dry-run.
  --apply escribe rasterLegend solo si la deteccion es confiable y no existe una leyenda manual valida.
  NODE_ENV=production se bloquea salvo que se use --allow-production explicitamente.`);
}

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function hasValidManualRasterLegend(value) {
  if (!value || value.source === "auto-detected") return false;
  const classes = Array.isArray(value.classes) ? value.classes : value.items;
  return Array.isArray(classes) && classes.length > 0 && classes.every((item) => item?.label && /^#[0-9a-f]{6}$/i.test(item?.color || ""));
}
