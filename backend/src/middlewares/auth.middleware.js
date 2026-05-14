import { verifyAccessToken } from "../shared/utils/jwt.js";
import { AppError } from "../shared/errors/app-error.js";

export function authMiddleware(req, _res, next) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return next(new AppError("Token de autenticación requerido.", 401));
  }

  const token = authorization.replace("Bearer ", "").trim();

  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch (_error) {
    return next(new AppError("Token inválido o expirado.", 401));
  }
}
