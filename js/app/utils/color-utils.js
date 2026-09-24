export function normalizeHexColor(value, fallback = null) {
  const normalizedFallback = normalizeHexColorValue(fallback);
  return normalizeHexColorValue(value) || normalizedFallback || fallback || null;
}

function normalizeHexColorValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const body = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-f]{3,8}$/i.test(body)) return null;

  if (body.length === 3 || body.length === 4) {
    return `#${body.split("").map((char) => `${char}${char}`).join("")}`.toLowerCase();
  }

  if (body.length === 6 || body.length === 8) {
    return `#${body}`.toLowerCase();
  }

  return null;
}
