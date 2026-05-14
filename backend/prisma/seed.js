import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const roles = [
    {
      code: "PUBLIC_USER",
      name: "Usuario público",
      description: "Consulta capas publicadas y consume el visor público.",
    },
    {
      code: "DATA_PROVIDER",
      name: "Proveedor de datos",
      description: "Carga capas para revisión institucional.",
    },
    {
      code: "ADMIN",
      name: "Administrador",
      description: "Administra usuarios, revisa capas y controla publicación.",
    },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        description: role.description,
      },
      create: role,
    });
  }

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { code: "ADMIN" },
  });

  const passwordHash = await bcrypt.hash(process.env.DEFAULT_ADMIN_PASSWORD, Number(process.env.BCRYPT_SALT_ROUNDS || 12));

  await prisma.user.upsert({
    where: { email: process.env.DEFAULT_ADMIN_EMAIL.toLowerCase() },
    update: {
      name: process.env.DEFAULT_ADMIN_NAME,
      passwordHash,
      isActive: true,
      roleId: adminRole.id,
    },
    create: {
      name: process.env.DEFAULT_ADMIN_NAME,
      email: process.env.DEFAULT_ADMIN_EMAIL.toLowerCase(),
      passwordHash,
      municipality: "Estado de Morelos",
      roleId: adminRole.id,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
