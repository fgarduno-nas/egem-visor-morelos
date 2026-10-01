import { INSTITUTIONAL_DIVISIONS, divisionUploadTagsError, divisionUploadError } from "../../../../shared/division-utils.js";
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
  source: z.string().max(180).optional().nullable(),
  responsibleAgency: z.string().max(180).optional().nullable(),
  updatedAt: z.string().max(40).optional().nullable(),
  scaleOrResolution: z.string().max(120).optional().nullable(),
  crs: z.string().max(120).optional().nullable(),
  rasterLegend: z.string().max(10000).optional().nullable(),
  vectorLegend: z.string().max(30000).optional().nullable(),
  division: z.enum(INSTITUTIONAL_DIVISIONS.map(item => item.key)).nullable().optional(),
  phenomenon: z.string().nullable().optional(),
  phenomenonKey: z.string().nullable().optional(),
  tags: tagsSchema,
  "tags[]": z.any().optional(),
}).superRefine((body, ctx) => {
  const parsedTags = tagsSchema.safeParse(body.tags?.length ? body.tags : body["tags[]"]);
  if (!parsedTags.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tags"], message: "La clasificación de fenómeno no es válida." });
    return;
  }
  const tags = parsedTags.data;
  body.tags = tags || [];
  const explicit = body.phenomenonKey || body.phenomenon;
  if (explicit && !body.tags.some(t => /^category:/i.test(t))) body.tags.push(explicit.startsWith("category:") ? explicit : `category:${explicit}`);
  const error = divisionUploadTagsError(body.tags, body.division, [body.phenomenon, body.phenomenonKey]);
  if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["division"], message: error });
});

export const uploadLayerSchema = z.object({
  body: uploadLayerBodySchema,
  params: z.object({}).default({}),
  query: z.object({}).default({}),
});

const paginatedNumberSchema = (fallback, min, max) =>
  z.preprocess((value) => {
    const parsed = Number.parseInt(String(value ?? fallback), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }, z.number().int().min(min).max(max).default(fallback));

const cappedNumberSchema = (fallback, min, max) =>
  z.preprocess((value) => {
    const parsed = Number.parseInt(String(value ?? fallback), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }, z.number().int().min(min).max(max).default(fallback));

const optionalFilterSchema = (max = 120) =>
  z.preprocess((value) => {
    if (value === undefined || value === null) return "";
    return String(value).trim();
  }, z.string().max(max).default(""));

export const adminLayerListSchema = z.object({
  body: z.object({}).default({}),
  params: z.object({}).default({}),
  query: z.object({
    page: paginatedNumberSchema(1, 1, 100000),
    pageSize: cappedNumberSchema(20, 1, 100),
    search: optionalFilterSchema(160),
    status: optionalFilterSchema(40),
    processingStatus: optionalFilterSchema(40),
    phenomenon: optionalFilterSchema(80),
    division: z.enum(["", ...INSTITUTIONAL_DIVISIONS.map(item => item.key)]).default(""),
  }).superRefine((query, ctx) => {
    if (query.phenomenon && query.division) {
      const error = divisionUploadError(query.phenomenon, query.division);
      if (error) ctx.addIssue({code:z.ZodIssueCode.custom,path:["phenomenon"],message:error});
    }
  }).default({}),
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

export const rasterLegendSchema = z.object({
  body: z.object({
    rasterLegend: z.union([z.string().max(10000), z.array(z.any()), z.record(z.any())]).nullable(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({}).default({}),
});
