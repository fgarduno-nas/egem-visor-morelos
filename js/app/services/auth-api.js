import { request } from "./http-client.js";

export async function loginRequest(email, password) {
  const payload = await request("/auth/login", {
    method: "POST",
    body: { email, password },
    retries: 0,
  });

  return payload?.data ?? null;
}
