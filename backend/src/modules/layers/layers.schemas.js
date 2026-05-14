import { z } from "zod";
import { LAYER_STATUS } from "../../shared/constants/layer-status.js";

export const uploadLayerBodySchema = z.object({
  title: z.string().min(3).max(180),
  description: z.string().max(2000).optional().nullable(),
  municipality: z.string().max(150).optional().nullable(),
  tags: z.array(z.string().min(1).max(40)).optional(),
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
