import { z } from "zod";
import { ROLE_CODES } from "../../shared/constants/roles.js";

const roleEnum = z.enum([ROLE_CODES.PUBLIC_USER, ROLE_CODES.DATA_PROVIDER, ROLE_CODES.ADMIN]);

export const createUserSchema = z.object({
  body: z.object({
    name: z.string().min(3).max(180),
    email: z.string().email(),
    password: z.string().min(8).max(128),
    municipality: z.string().min(2).max(150).nullable().optional(),
    roleCode: roleEnum,
  }),
  params: z.object({}).default({}),
  query: z.object({}).default({}),
});

export const updateUserSchema = z.object({
  body: z.object({
    name: z.string().min(3).max(180).optional(),
    email: z.string().email().optional(),
    municipality: z.string().min(2).max(150).nullable().optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({}).default({}),
});

export const toggleUserSchema = z.object({
  body: z.object({
    isActive: z.boolean(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({}).default({}),
});

export const changeRoleSchema = z.object({
  body: z.object({
    roleCode: roleEnum,
  }),
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({}).default({}),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    password: z.string().min(8).max(128),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({}).default({}),
});
