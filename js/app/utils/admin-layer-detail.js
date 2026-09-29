import { normalizePhenomenonForDisplay } from "../../../shared/phenomenon-utils.js";

const missing = "No especificado";
const scalar = value => (typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value) ? String(value) : missing);
const escape = value => scalar(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const validColor = value => /^#[0-9a-f]{6}$/i.test(value || "") ? value : null;
const statuses = { draft: "Borrador", pending_review: "Pendiente de revisión", approved: "Aprobada", rejected: "Rechazada", published: "Publicada", unpublished: "No publicada", deleted: "Eliminada" };
const processing = { pending: "Pendiente", processing: "En proceso", processed: "Procesada", failed: "Fallida" };
const types = { vector: "Vectorial", raster: "Raster", "ground-overlay": "GroundOverlay", mixed: "Mixto" };

export function adminDetailDate(value) {
  if (typeof value !== "string" || !value.trim()) return missing;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? missing : new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function section(title, items) {
  return `<section class="admin-detail-section"><h5>${escape(title)}</h5><dl class="admin-layer-detail-grid">${items.map(([label, value, technical]) => `<div><dt>${escape(label)}</dt><dd${technical ? ' class="technical-value"' : ""}>${escape(value)}</dd></div>`).join("")}</dl></section>`;
}

function symbolMarkup(item) {
  const fill = validColor(item.color);
  const shapes = {
    circle: '<circle cx="16" cy="16" r="10"/>',
    triangle: '<path d="M16 4 L29 27 H3 Z"/>',
    square: '<rect x="6" y="6" width="20" height="20"/>',
    fill: '<rect x="3" y="7" width="26" height="18"/>',
    line: '<path d="M2 25 L12 12 L21 19 L30 6" fill="none" stroke-width="4"/>',
  };
  if (!fill || !shapes[item.symbol]) return '<span class="admin-detail-swatch" aria-hidden="true">?</span>';
  return `<svg class="admin-detail-swatch" viewBox="0 0 32 32" aria-hidden="true" fill="${fill}" stroke="${item.symbol === "line" ? fill : "#3a3333"}">${shapes[item.symbol]}</svg>`;
}

function legend(title, data) {
  const shapes = { circle: "Círculo", triangle: "Triángulo", square: "Cuadrado", fill: "Relleno", line: "Línea", icon: "Icono original (sin vista previa)" };
  if (!data?.classes?.length) return `<div><h6>${escape(title)}</h6><p>${missing}</p></div>`;
  return `<div><h6>${escape(title)} · ${escape(data.title)}</h6><ol class="admin-detail-legend">${data.classes.map(item => {
    const original = [];
    if (scalar(item.originalLabel) !== missing && item.originalLabel !== item.label) original.push(`Nombre original: ${scalar(item.originalLabel)}`);
    if (validColor(item.originalColor) && item.originalColor !== item.color) original.push(`Color original: ${item.originalColor}`);
    const values = [];
    if (scalar(item.value) !== missing) values.push(`Valor: ${scalar(item.value)}`);
    if (scalar(item.min) !== missing || scalar(item.max) !== missing) values.push(`Intervalo: ${scalar(item.min)}–${scalar(item.max)}`);
    return `<li>${symbolMarkup(item)}<div><strong>${escape(item.label)}</strong><span>Orden: ${escape(item.order)} · ${escape(shapes[item.symbol])} · ${escape(validColor(item.color))}</span>${item.group ? `<span>Grupo: ${escape(item.group)}</span>` : ""}${values.length ? `<span>${escape(values.join(" · "))}</span>` : ""}${original.length ? `<small>${escape(original.join(" · "))}</small>` : ""}</div></li>`;
  }).join("")}</ol></div>`;
}

export function renderAdminLayerDetail(layer) {
  const owner = layer.submittedBy || {};
  const files = Array.isArray(layer.files) ? layer.files : [];
  const names = files.map(file => scalar(file.originalName)).join(", ");
  const extensions = [...new Set(files.map(file => scalar(file.extension)))].join(", ") || layer.sourceType;
  const fileTypes = [...new Set(files.map(file => scalar(file.mimeType)))].join(", ");
  const phenomenon = normalizePhenomenonForDisplay(layer.phenomenon || layer.phenomenonKey).displayLabel;
  const resource = layer.resourceType;
  const legends = [];
  if (["vector", "mixed"].includes(resource)) legends.push(legend("Leyenda vectorial", layer.symbology?.vector));
  if (["raster", "ground-overlay", "mixed"].includes(resource)) legends.push(legend("Leyenda raster", layer.symbology?.raster));
  return `<div class="admin-layer-details__header"><h4>Detalle de capa</h4></div>` +
    section("Información capturada durante la carga", [
      ["Nombre de la capa", layer.title], ["Fenómeno", phenomenon === "Sin clasificar" ? missing : phenomenon],
      ["Descripción", layer.description], ["Municipio o cobertura", layer.municipality], ["Fuente", layer.source],
      ["Dependencia responsable", layer.responsibleAgency], ["Fecha de actualización de los datos", layer.sourceUpdatedAt],
      ["Escala o resolución", layer.scaleOrResolution], ["Sistema de referencia capturado", layer.capturedCrs, true],
      ["Archivo original", names, true], ["Formato o extensión", extensions, true],
    ]) + section("Responsable y registro", [
      ["Responsable de la carga", owner.name === "Usuario no disponible" ? missing : owner.name], ["Correo", owner.email, true],
      ["Fecha y hora de carga", adminDetailDate(layer.submittedAt || layer.createdAt)],
      ["Última actualización del registro", adminDetailDate(layer.updatedAt)],
      ["Estado administrativo", statuses[layer.isDeleted ? "deleted" : layer.status]],
    ]) + `<section class="admin-detail-section"><h5>Simbología capturada</h5>${legends.join("") || `<p>${missing}</p>`}</section>` +
    section("Información técnica", [
      ["Tipo de recurso", types[resource]], ["Geometría", layer.geometryType, true], ["Objetos o features", layer.featureCount],
      ["CRS del recurso procesado", layer.crs, true], ["Procesamiento", processing[layer.processingStatus]],
      ["Visualizable", layer.isVisualizable === true ? "Sí" : layer.isVisualizable === false ? "No" : missing],
      ["Cantidad de archivos registrados", files.length], ["Tipos de archivo", fileTypes, true],
      ...(layer.processingMessage ? [["Observación de procesamiento", layer.processingMessage]] : []),
    ]) + '<div class="admin-layer-details__actions"><button class="ghost-button" type="button" data-admin-layer-return>Volver a la tabla</button></div>';
}
