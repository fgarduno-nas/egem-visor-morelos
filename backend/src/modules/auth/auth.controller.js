import { sendSuccess } from "../../shared/utils/api-response.js";
import { loginUser } from "./auth.service.js";

export async function login(req, res) {
  const data = await loginUser({
    ...req.validated.body,
    req,
  });

  return sendSuccess(res, {
    statusCode: 200,
    message: "Login exitoso.",
    data,
  });
}
