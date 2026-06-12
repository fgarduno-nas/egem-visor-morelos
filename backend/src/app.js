import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import { env } from "./config/env.js";
import { apiRouter } from "./routes.js";
import { sanitizeInputMiddleware } from "./middlewares/sanitize.middleware.js";
import { notFoundMiddleware } from "./middlewares/not-found.middleware.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";

export const app = express();
app.set("trust proxy", 1);

const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Demasiadas solicitudes. Intenta nuevamente más tarde.",
  },
});

app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.CORS_ORIGIN.includes(origin) || isAllowedDevelopmentOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origen no permitido por CORS"));
    },
    credentials: true,
  })
);

function isAllowedDevelopmentOrigin(origin) {
  if (env.NODE_ENV === "production") return false;
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch (_error) {
    return false;
  }
}
app.use(limiter);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(sanitizeInputMiddleware);
app.use(
  "/uploads",
  express.static(env.UPLOAD_BASE_DIR, {
    etag: true,
    maxAge: "1h",
  })
);

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "EGEM backend operativo",
    timestamp: new Date().toISOString(),
  });
});

app.use(env.API_PREFIX, apiRouter);
app.use(notFoundMiddleware);
app.use(errorMiddleware);
