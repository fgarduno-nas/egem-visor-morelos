import { prisma } from "../../config/database.js";

export async function createAuditLog({
  actorId = null,
  entityType,
  entityId,
  action,
  description,
  metadata = null,
  ipAddress = null,
  userAgent = null,
}) {
  return prisma.auditLog.create({
    data: {
      actorId,
      entityType,
      entityId,
      action,
      description,
      metadata,
      ipAddress,
      userAgent,
    },
  });
}
