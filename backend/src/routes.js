import express, { Router } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { authRouter } from "./modules/auth/auth.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { layersRouter } from "./modules/layers/layers.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const apiRouter = Router();

apiRouter.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "API EGEM disponible",
    docs: "/api/v1/docs/openapi.yaml",
  });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/layers", layersRouter);
apiRouter.use("/docs", express.static(path.join(__dirname, "../docs")));
