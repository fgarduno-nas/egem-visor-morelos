// This expiry check only avoids known-invalid requests. The API remains the
// authority for signature validation, revoked tokens and access permissions.
export function hasCurrentAccessToken(session, now = Date.now()) {
  if (typeof session?.token !== "string") return false;
  try {
    const parts = session.token.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[2]) return false;
    const payload = JSON.parse(atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")));
    return Number.isFinite(payload.exp) && payload.exp * 1000 > now;
  } catch { return false; }
}

export function restorableSession(session, now = Date.now()) {
  if (session?.isAuthenticated !== true || !["admin", "director"].includes(session.role)) return null;
  if (!session.token && ["demo", "local-demo"].includes(session.source)) return session;
  return hasCurrentAccessToken(session, now) ? session : null;
}

export async function loadPrivateCatalog(session, { currentSession, listAdmin, listOwn, onUnauthorized }) {
  if (session?.isAuthenticated !== true || !session.token || !["admin", "director"].includes(session.role)) return [];
  // Do not let a response from the previous account change the current one.
  if (currentSession() !== session) return [];
  if (!hasCurrentAccessToken(session)) {
    onUnauthorized();
    return [];
  }
  try {
    const records = await (session.role === "admin" ? listAdmin(session.token) : listOwn(session.token));
    return currentSession() === session ? records : [];
  } catch (error) {
    if (currentSession() !== session) return [];
    if (error?.status !== 401) throw error;
    onUnauthorized();
    return [];
  }
}
