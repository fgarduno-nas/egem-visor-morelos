export function sendSuccess(res, { statusCode = 200, message, data = null, meta = null }) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    meta,
  });
}
