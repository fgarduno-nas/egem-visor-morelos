import { buildApiUrl, runtimeConfig } from "../config/runtime-config.js";

const responseCache = new Map();
const inflightRequests = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(error, attempt, maxAttempts) {
  if (attempt >= maxAttempts) return false;
  if (error?.name === "AbortError") return false;
  if (error?.status && error.status < 500) return false;
  return true;
}

async function parseJsonSafely(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_error) {
    return {
      success: false,
      message: "La API devolvio una respuesta no JSON.",
      raw: text,
    };
  }
}

export async function request(pathname, options = {}) {
  const {
    method = "GET",
    body,
    token,
    headers = {},
    timeoutMs = runtimeConfig.requestTimeoutMs,
    retries = method === "GET" ? runtimeConfig.retryAttempts : 0,
    cacheTtlMs = 0,
    cacheKey = `${method}:${pathname}`,
    dedupe = method === "GET",
  } = options;

  const now = Date.now();
  const cached = cacheTtlMs > 0 ? responseCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (dedupe && inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const run = async () => {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(buildApiUrl(pathname), {
          method,
          headers: {
            ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers,
          },
          body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        const payload = await parseJsonSafely(response);
        if (!response.ok) {
          const error = new Error(payload?.message || "La solicitud no pudo completarse.");
          error.status = response.status;
          error.payload = payload;
          throw error;
        }

        if (cacheTtlMs > 0) {
          responseCache.set(cacheKey, {
            value: payload,
            expiresAt: Date.now() + cacheTtlMs,
          });
        }

        return payload;
      } catch (error) {
        lastError = error;
        if (!shouldRetry(error, attempt, retries)) {
          throw error;
        }

        await sleep(runtimeConfig.retryDelayMs * (attempt + 1));
      }
    }

    throw lastError;
  };

  const promise = run().finally(() => {
    clearTimeout(timeoutId);
    inflightRequests.delete(cacheKey);
  });

  if (dedupe) {
    inflightRequests.set(cacheKey, promise);
  }

  return promise;
}

export function invalidateCache(prefix = "") {
  if (!prefix) {
    responseCache.clear();
    return;
  }

  [...responseCache.keys()].forEach((key) => {
    if (key.includes(prefix)) {
      responseCache.delete(key);
    }
  });
}
