import { Router } from "express";

import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/roles.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../shared/utils/async-handler.js";
import { ROLE_CODES } from "../../shared/constants/roles.js";
import {
  changeRoleController,
  createUserController,
  listUsersController,
  toggleUserController,
  updateUserController,
} from "./users.controller.js";
import {
  changeRoleSchema,
  createUserSchema,
  toggleUserSchema,
  updateUserSchema,
} from "./users.schemas.js";

export const usersRouter = Router();

usersRouter.use(authMiddleware, authorizeRoles(ROLE_CODES.ADMIN));
usersRouter.post("/", validate(createUserSchema), asyncHandler(createUserController));
usersRouter.get("/", asyncHandler(listUsersController));
usersRouter.patch("/:id", validate(updateUserSchema), asyncHandler(updateUserController));
usersRouter.patch("/:id/status", validate(toggleUserSchema), asyncHandler(toggleUserController));
usersRouter.patch("/:id/role", validate(changeRoleSchema), asyncHandler(changeRoleController));
