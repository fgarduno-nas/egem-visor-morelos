import { LAYER_STATUS } from "../../shared/constants/layer-status.js";

export function isLayerPubliclyAccessible(layer) {
  if (!layer || layer.status !== LAYER_STATUS.PUBLISHED || layer.isDeleted !== false) {
    return false;
  }
  return readCanonicalBoolean(layer, "isVisualizable") === true &&
    readCanonicalString(layer, "processingStatus") === "processed";
}

function readCanonicalBoolean(layer, field) {
  if (Object.prototype.hasOwnProperty.call(layer, field)) {
    return layer[field] === true;
  }
  return layer.metadata?.properties?.[field] === true;
}

function readCanonicalString(layer, field) {
  if (Object.prototype.hasOwnProperty.call(layer, field)) {
    return typeof layer[field] === "string" ? layer[field] : null;
  }
  const fallback = layer.metadata?.properties?.[field];
  return typeof fallback === "string" ? fallback : null;
}
