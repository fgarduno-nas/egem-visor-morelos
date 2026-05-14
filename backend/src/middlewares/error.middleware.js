import multer from "multer";
import { ZodError } from "zod";

export function errorMiddleware(error, _req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validación fallida",
      errors: error.flatten().fieldErrors,
    });
  }

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  const statusCode = error.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    message: error.message || "Error interno del servidor",
    details: error.details || null,
  });
}
