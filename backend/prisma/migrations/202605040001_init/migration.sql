CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE "LayerStatus" AS ENUM (
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'published',
  'unpublished'
);

CREATE TYPE "AuditAction" AS ENUM (
  'LOGIN_SUCCESS',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_STATUS_CHANGED',
  'USER_ROLE_CHANGED',
  'LAYER_CREATED',
  'LAYER_APPROVED',
  'LAYER_REJECTED',
  'LAYER_PUBLISHED',
  'LAYER_UNPUBLISHED',
  'LAYER_DELETED'
);

CREATE TABLE "Role" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "municipality" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "roleId" TEXT NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Layer" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "municipality" TEXT,
  "sourceType" TEXT,
  "status" "LayerStatus" NOT NULL DEFAULT 'draft',
  "rejectedReason" TEXT,
  "publishedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  CONSTRAINT "Layer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LayerFile" (
  "id" TEXT NOT NULL,
  "layerId" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "extension" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksum" TEXT,
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LayerFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LayerMetadata" (
  "id" TEXT NOT NULL,
  "layerId" TEXT NOT NULL,
  "featureCount" INTEGER,
  "geometryType" TEXT,
  "bbox" JSONB,
  "crs" TEXT,
  "properties" JSONB,
  "preview" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LayerMetadata_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApprovalHistory" (
  "id" TEXT NOT NULL,
  "layerId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "fromStatus" "LayerStatus" NOT NULL,
  "toStatus" "LayerStatus" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" "AuditAction" NOT NULL,
  "description" TEXT NOT NULL,
  "metadata" JSONB,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Layer_slug_key" ON "Layer"("slug");
CREATE UNIQUE INDEX "LayerMetadata_layerId_key" ON "LayerMetadata"("layerId");

ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey"
FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Layer" ADD CONSTRAINT "Layer_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LayerFile" ADD CONSTRAINT "LayerFile_layerId_fkey"
FOREIGN KEY ("layerId") REFERENCES "Layer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LayerMetadata" ADD CONSTRAINT "LayerMetadata_layerId_fkey"
FOREIGN KEY ("layerId") REFERENCES "Layer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_layerId_fkey"
FOREIGN KEY ("layerId") REFERENCES "Layer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
