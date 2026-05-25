import { z } from "zod";
import { LAYER_STATUS } from "../../shared/constants/layer-status.js";

const tagsSchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }

  if (value && typeof value === "object") {
    const direct = value.tags;
    const bracket = value["tags[]"];
    const selected = bracket ?? direct;

    if (Array.isArray(selected)) {
      return selected.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
    }

    if (typeof selected === "string") {
      const normalized = selected.trim();
      return normalized ? [normalized] : [];
    }
  }

  return [];
}, z.array(z.string().min(1).max(80)).optional());

export const uploadLayerBodySchema = z.object({
  title: z.string().min(3).max(180),
  description: z.string().max(2000).optional().nullable(),
  municipality: z.string().max(150).optional().nullable(),
  tags: tagsSchema,
  "tags[]": z.any().optional(),
});

export const uploadLayerSchema = z.object({
  body: uploadLayerBodySchema,
  params: z.object({}).default({}),
  query: z.object({}).default({}),
});

export const layerIdSchema = z.object({
  body: z.object({}).default({}),
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({}).default({}),
});

export const rejectLayerSchema = z.object({
  body: z.object({
    reason: z.string().min(5).max(600),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({}).default({}),
});

export const publishStateSchema = z.object({
  body: z.object({
    status: z.enum([LAYER_STATUS.PUBLISHED, LAYER_STATUS.UNPUBLISHED]),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({}).default({}),
});
