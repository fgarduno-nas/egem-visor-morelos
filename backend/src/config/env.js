import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default("/api/v1"),
  APP_NAME: z.string().default("EGEM Backend"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("8h"),
  BCRYPT_SALT_ROUNDS: z.coerce.number().min(10).max(15).default(12),
  CORS_ORIGIN: z.string().default("http://localhost:5500,http://127.0.0.1:5500"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(150),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().default(100),
  UPLOAD_BASE_DIR: z.string().default("uploads"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4000"),
  DEFAULT_ADMIN_EMAIL: z.string().email(),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8),
  DEFAULT_ADMIN_NAME: z.string().min(3),
});

const parsed = envSchema.safeParse({
  ...process.env,
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5500,http://127.0.0.1:5500",
});

if (!parsed.success) {
  console.error("Variables de entorno inválidas", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  CORS_ORIGIN: parsed.data.CORS_ORIGIN.split(",").map((item) => item.trim()).filter(Boolean),
};
