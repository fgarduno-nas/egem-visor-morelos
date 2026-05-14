export function getRequestMetadata(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  };
}
