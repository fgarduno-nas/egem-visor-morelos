import { normalizeHexColor } from "./color-utils.js";

const POINT_ICON_DEFAULT_COLORS = Object.freeze({
  triangle: "#123c7c",
  dot: "#73dfff",
  "generic-dot": "#3b82f6",
});

export function createFallbackPointIcon(kind, color = null, options = {}) {
  const size = kind === "triangle" ? 12 : 8;
  const canvas = options.canvasFactory
    ? options.canvasFactory(size)
    : document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  context.clearRect(0, 0, size, size);
  context.fillStyle = normalizeHexColor(color, POINT_ICON_DEFAULT_COLORS[kind] || POINT_ICON_DEFAULT_COLORS["generic-dot"]);
  context.strokeStyle = "rgba(255,255,255,0.72)";
  context.lineWidth = 1;

  if (kind === "triangle") {
    context.beginPath();
    context.moveTo(size / 2, 1);
    context.lineTo(size - 1, size - 1);
    context.lineTo(1, size - 1);
    context.closePath();
  } else {
    context.beginPath();
    context.arc(size / 2, size / 2, 3, 0, Math.PI * 2);
  }

  context.fill();
  context.stroke();
  return context.getImageData(0, 0, size, size);
}
