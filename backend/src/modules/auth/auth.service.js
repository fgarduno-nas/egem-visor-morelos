import { prisma } from "../../config/database.js";
import { AppError } from "../../shared/errors/app-error.js";
import { verifyPassword } from "../../shared/utils/password.js";
import { signAccessToken } from "../../shared/utils/jwt.js";
import { createAuditLog } from "../../shared/services/audit.service.js";
import { getRequestMetadata } from "../../shared/utils/request-metadata.js";

export async function loginUser({ email, password, req }) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { role: true },
  });

  if (!user || !user.isActive) {
    throw new AppError("Credenciales inválidas.", 401);
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    throw new AppError("Credenciales inválidas.", 401);
  }

  const token = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role.code,
    municipality: user.municipality,
    name: user.name,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const metadata = getRequestMetadata(req);
  await createAuditLog({
    actorId: user.id,
    entityType: "User",
    entityId: user.id,
    action: "LOGIN_SUCCESS",
    description: "Inicio de sesión exitoso.",
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  });

  return {
    accessToken: token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      municipality: user.municipality,
      role: user.role.code,
    },
  };
}
