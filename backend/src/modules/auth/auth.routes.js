import { Router } from "express";

import { login } from "./auth.controller.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { loginSchema } from "./auth.schemas.js";
import { asyncHandler } from "../../shared/utils/async-handler.js";

export const authRouter = Router();

authRouter.post("/login", validate(loginSchema), asyncHandler(login));
