import { prisma } from "../../config/database.js";
import { AppError } from "../../shared/errors/app-error.js";
import { hashPassword } from "../../shared/utils/password.js";
import { createAuditLog } from "../../shared/services/audit.service.js";
import { getRequestMetadata } from "../../shared/utils/request-metadata.js";

async function getRoleOrFail(roleCode) {
  const role = await prisma.role.findUnique({ where: { code: roleCode } });
  if (!role) throw new AppError("Rol no encontrado.", 404);
  return role;
}

export async function createUser(payload, actor, req) {
  const existing = await prisma.user.findUnique({
    where: { email: payload.email.toLowerCase() },
  });

  if (existing) {
    throw new AppError("El correo ya está registrado.", 409);
  }

  const role = await getRoleOrFail(payload.roleCode);
  const passwordHash = await hashPassword(payload.password);

  const user = await prisma.user.create({
    data: {
      name: payload.name,
      email: payload.email.toLowerCase(),
      passwordHash,
      municipality: payload.municipality || null,
      roleId: role.id,
    },
    include: { role: true },
  });

  const metadata = getRequestMetadata(req);
  await createAuditLog({
    actorId: actor.sub,
    entityType: "User",
    entityId: user.id,
    action: "USER_CREATED",
    description: `Usuario ${user.email} creado.`,
    metadata: { role: role.code },
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  });

  return sanitizeUser(user);
}

export async function listUsers() {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    include: { role: true },
    orderBy: { createdAt: "desc" },
  });

  return users.map(sanitizeUser);
}

export async function updateUser(id, payload, actor, req) {
  const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);

  const updated = await prisma.user.update({
    where: { id },
    data: {
      name: payload.name ?? user.name,
      email: payload.email?.toLowerCase() ?? user.email,
      municipality: payload.municipality ?? user.municipality,
    },
    include: { role: true },
  });

  const metadata = getRequestMetadata(req);
  await createAuditLog({
    actorId: actor.sub,
    entityType: "User",
    entityId: updated.id,
    action: "USER_UPDATED",
    description: `Usuario ${updated.email} actualizado.`,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  });

  return sanitizeUser(updated);
}

export async function toggleUser(id, isActive, actor, req) {
  const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);

  const updated = await prisma.user.update({
    where: { id },
    data: { isActive },
    include: { role: true },
  });

  const metadata = getRequestMetadata(req);
  await createAuditLog({
    actorId: actor.sub,
    entityType: "User",
    entityId: updated.id,
    action: "USER_STATUS_CHANGED",
    description: `Usuario ${updated.email} ${isActive ? "activado" : "desactivado"}.`,
    metadata: { isActive },
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  });

  return sanitizeUser(updated);
}

export async function changeUserRole(id, roleCode, actor, req) {
  const role = await getRoleOrFail(roleCode);
  const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);

  const updated = await prisma.user.update({
    where: { id },
    data: { roleId: role.id },
    include: { role: true },
  });

  const metadata = getRequestMetadata(req);
  await createAuditLog({
    actorId: actor.sub,
    entityType: "User",
    entityId: updated.id,
    action: "USER_ROLE_CHANGED",
    description: `Rol de usuario ${updated.email} cambiado a ${role.code}.`,
    metadata: { roleCode },
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  });

  return sanitizeUser(updated);
}

export async function resetUserPassword(id, password, actor, req) {
  const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);

  const passwordHash = await hashPassword(password);
  const updated = await prisma.user.update({
    where: { id },
    data: { passwordHash },
    include: { role: true },
  });

  const metadata = getRequestMetadata(req);
  await createAuditLog({
    actorId: actor.sub,
    entityType: "User",
    entityId: updated.id,
    action: "USER_UPDATED",
    description: `Contrasena de usuario ${updated.email} restablecida por administrador.`,
    metadata: { passwordResetByAdmin: true },
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  });

  return sanitizeUser(updated);
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    municipality: user.municipality,
    isActive: user.isActive,
    role: user.role.code,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
