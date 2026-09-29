// Explicit, read-only projection. Never include storage references or raw metadata.
const text = value => typeof value === "string" && value.trim() ? value.trim() : null;
const color = value => /^#[\da-f]{6}$/i.test(value || "") ? value.toLowerCase() : null;
const number = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

export function adminResourceType(properties, geometry, sourceType) {
  if (["vector", "raster", "ground-overlay", "mixed"].includes(properties.resourceType)) return properties.resourceType;
  const raster = Array.isArray(properties.groundOverlays) && properties.groundOverlays.length > 0;
  if (raster) return geometry ? "mixed" : "ground-overlay";
  if (["tif", "tiff", "geotiff"].includes(String(sourceType || "").toLowerCase())) return "raster";
  return geometry ? "vector" : null;
}

export function safeAdminFilename(value) {
  return text(value)?.replaceAll("\\", "/").split("/").pop() || null;
}

export function safeAdminProcessingMessage(properties) {
  // Free-form processing diagnostics can contain paths, stack traces and secrets.
  // Keep those server-side; describe the actionable state instead.
  if (properties.processingStatus === "failed") return "No se pudo procesar la capa. Revisa el formato y la integridad del archivo antes de volver a cargarlo.";
  if (properties.processingStatus === "pending") return "La capa está pendiente de procesamiento.";
  if (properties.isVisualizable === false) return "El recurso está registrado, pero todavía no es visualizable.";
  return null;
}

function symbol(item, resourceType, geometry) {
  const role = String(item.geometryRole || item.group || item.folder || "").toLowerCase();
  const kind = String(item.symbolType || item.symbolKind || "").toLowerCase();
  if (resourceType === "raster") return "fill";
  if (role.includes("pozo")) return "triangle";
  if (role.includes("manantial")) return "circle";
  if (["circle", "dot"].includes(kind)) return "circle";
  if (["triangle", "square"].includes(kind)) return kind;
  if (kind === "line" || /line/.test(role) || /Line/.test(geometry || "")) return "line";
  if (kind === "icon" || item.iconHref) return "icon";
  if (/polygon/.test(role)) return "fill";
  if (/Point/.test(geometry || "")) return "circle";
  if (/polygon/.test(role) || /Polygon/.test(geometry || "") || kind === "color") return "fill";
  return null;
}

function projectLegend(legend, type, geometry) {
  if (!legend) return null;
  const classes = Array.isArray(legend) ? legend : legend.classes || legend.items;
  if (!Array.isArray(classes) || !classes.length) return null;
  return {
    title: text(legend.field || legend.title || legend.name),
    classes: classes.filter(item => item && typeof item === "object").map(item => ({
      label: text(item.displayLabel) || text(item.label),
      color: color(item.displayColor) || color(item.color),
      originalLabel: text(item.originalLabel) || text(item.label),
      originalColor: color(item.originalColor) || color(item.color),
      value: text(item.value) || number(item.value),
      min: number(item.min), max: number(item.max),
      order: number(item.displayOrder ?? item.order ?? item.sourceOrder),
      group: text(item.group || item.folder),
      symbol: symbol(item, type, geometry),
    })),
  };
}

export function safeAdminSymbology(properties, resourceType, geometry) {
  const vector = ["raster", "ground-overlay"].includes(resourceType) ? null : projectLegend(properties.vectorLegend, "vector", geometry);
  const raster = ["raster", "ground-overlay", "mixed"].includes(resourceType) ? projectLegend(properties.rasterLegend, "raster", geometry) : null;
  return {
    vector, raster,
    vectorClassCount: vector?.classes.length || 0,
    rasterClassCount: raster?.classes.length || 0,
    hasVectorLegend: Boolean(vector), hasRasterLegend: Boolean(raster),
  };
}
