const globalConfig = window.__EGEM_CONFIG__ ?? {};

const localApiBaseUrl = "http://localhost:4000/api/v1";
const productionApiBaseUrl = "https://egem-backend.onrender.com/api/v1";

export const runtimeConfig = {
  apiBaseUrl: String(
    globalConfig.apiBaseUrl ||
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? localApiBaseUrl
        : productionApiBaseUrl)
  ).replace(/\/+$/, ""),
  requestTimeoutMs: Number(globalConfig.requestTimeoutMs || 12000),
  publicLayerCacheTtlMs: Number(globalConfig.publicLayerCacheTtlMs || 120000),
  retryAttempts: Number(globalConfig.retryAttempts || 2),
  retryDelayMs: Number(globalConfig.retryDelayMs || 450),
};

export function buildApiUrl(pathname) {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${runtimeConfig.apiBaseUrl}${normalizedPath}`;
}
