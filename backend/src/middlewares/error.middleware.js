import multer from "multer";
import { ZodError } from "zod";
import { UPLOAD_SIZE_ERROR, UPLOAD_FILE_COUNT_ERROR } from "../../../shared/upload-limits.js";

export function errorMiddleware(error, _req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validación fallida",
      errors: error.flatten().fieldErrors,
    });
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ success: false, code: error.code, message: UPLOAD_SIZE_ERROR });
    }
    return res.status(400).json({
      success: false,
      message: ["LIMIT_FILE_COUNT", "LIMIT_UNEXPECTED_FILE"].includes(error.code) ? UPLOAD_FILE_COUNT_ERROR : error.message,
    });
  }

  const statusCode = error.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    ...(error.code ? { code: error.code } : {}),
    message: error.message || "Error interno del servidor",
    details: error.details || null,
  });
}
