import { AppError } from "../shared/errors/app-error.js";

export function authorizeRoles(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError("Usuario no autenticado.", 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError("No tienes permisos para esta acción.", 403));
    }

    return next();
  };
}
