const keys = new Map();

async function identityStorageKey(metadata, files) {
  const identity = JSON.stringify({ metadata, files: files.map(file => [file.name, file.size, file.lastModified]) });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return "egem-upload:" + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
}

// Se conserva tras timeout/reintento y recarga de la pestaña. El backend compara
// también metadatos y checksums: una colisión de identidad nunca reutiliza otros datos.
export async function uploadRetryKey(metadata, files) {
  const storageKey = await identityStorageKey(metadata, files);
  let key;
  try { key = sessionStorage.getItem(storageKey); } catch (_) { /* Sin almacenamiento: misma sesión en memoria. */ }
  key ||= keys.get(storageKey) || crypto.randomUUID();
  keys.set(storageKey, key);
  try { sessionStorage.setItem(storageKey, key); } catch (_) { /* No impide la carga. */ }
  return key;
}

export async function confirmUploadRetry(metadata, files) {
  const storageKey = await identityStorageKey(metadata, files);
  keys.delete(storageKey);
  try { sessionStorage.removeItem(storageKey); } catch (_) { /* No hay persistencia disponible. */ }
}
