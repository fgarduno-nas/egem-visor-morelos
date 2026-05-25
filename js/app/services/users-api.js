import { request } from "./http-client.js";

export async function listUsersRequest(token) {
  const payload = await request("/users", {
    token,
    cacheTtlMs: 15000,
    cacheKey: "GET:/users",
  });

  return payload?.data ?? [];
}

export async function createUserRequest(token, userPayload) {
  const payload = await request("/users", {
    method: "POST",
    token,
    body: userPayload,
    retries: 0,
  });

  return payload?.data ?? null;
}

export async function resetPasswordRequest(token, userId, password) {
  const payload = await request(`/users/${userId}/password`, {
    method: "PATCH",
    token,
    body: { password },
    retries: 0,
  });

  return payload?.data ?? null;
}
