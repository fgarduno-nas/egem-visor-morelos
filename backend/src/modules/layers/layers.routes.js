import { Router } from "express";

import { asyncHandler } from "../../shared/utils/async-handler.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { authorizeRoles } from "../../middlewares/roles.middleware.js";
import { upload } from "../../config/upload.js";
import { ROLE_CODES } from "../../shared/constants/roles.js";
import {
  approveLayerController,
  deleteLayerController,
  getLayerDetailController,
  listAdminLayersController,
  listOwnLayersController,
  listPendingLayersController,
  listPublicLayersController,
  publishLayerController,
  rejectLayerController,
  uploadLayerController,
} from "./layers.controller.js";
import {
  layerIdSchema,
  publishStateSchema,
  rejectLayerSchema,
  uploadLayerSchema,
} from "./layers.schemas.js";

export const layersRouter = Router();

layersRouter.get("/public", asyncHandler(listPublicLayersController));

layersRouter.use(authMiddleware);
layersRouter.get(
  "/mine",
  authorizeRoles(ROLE_CODES.ADMIN, ROLE_CODES.DATA_PROVIDER),
  asyncHandler(listOwnLayersController)
);
layersRouter.get(
  "/admin/pending",
  authorizeRoles(ROLE_CODES.ADMIN),
  asyncHandler(listPendingLayersController)
);
layersRouter.get(
  "/admin/manageable",
  authorizeRoles(ROLE_CODES.ADMIN),
  asyncHandler(listAdminLayersController)
);
layersRouter.post(
  "/",
  authorizeRoles(ROLE_CODES.ADMIN, ROLE_CODES.DATA_PROVIDER),
  upload.array("files", 10),
  validate(uploadLayerSchema),
  asyncHandler(uploadLayerController)
);
layersRouter.patch(
  "/:id/approve",
  authorizeRoles(ROLE_CODES.ADMIN),
  validate(layerIdSchema),
  asyncHandler(approveLayerController)
);
layersRouter.patch(
  "/:id/reject",
  authorizeRoles(ROLE_CODES.ADMIN),
  validate(rejectLayerSchema),
  asyncHandler(rejectLayerController)
);
layersRouter.patch(
  "/:id/publish-state",
  authorizeRoles(ROLE_CODES.ADMIN),
  validate(publishStateSchema),
  asyncHandler(publishLayerController)
);
layersRouter.delete(
  "/:id",
  authorizeRoles(ROLE_CODES.ADMIN),
  validate(layerIdSchema),
  asyncHandler(deleteLayerController)
);
layersRouter.get("/:id", validate(layerIdSchema), asyncHandler(getLayerDetailController));
