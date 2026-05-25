import { sendSuccess } from "../../shared/utils/api-response.js";
import {
  approveLayer,
  deleteLayer,
  getLayerDetail,
  listAdminLayers,
  listOwnLayers,
  listPendingLayers,
  listPublicLayers,
  publishLayer,
  rejectLayer,
  uploadLayer,
} from "./layers.service.js";

export async function uploadLayerController(req, res) {
  const layer = await uploadLayer({
    body: req.validated.body,
    files: req.files,
    actor: req.user,
    req,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: "Capa cargada correctamente.",
    data: layer,
  });
}

export async function listPublicLayersController(_req, res) {
  const layers = await listPublicLayers();
  return sendSuccess(res, {
    statusCode: 200,
    message: "Capas públicas listadas correctamente.",
    data: layers,
  });
}

export async function listPendingLayersController(_req, res) {
  const layers = await listPendingLayers();
  return sendSuccess(res, {
    statusCode: 200,
    message: "Capas pendientes listadas correctamente.",
    data: layers,
  });
}

export async function listAdminLayersController(_req, res) {
  const layers = await listAdminLayers();
  return sendSuccess(res, {
    statusCode: 200,
    message: "Capas administrables listadas correctamente.",
    data: layers,
  });
}

export async function listOwnLayersController(req, res) {
  const layers = await listOwnLayers(req.user);
  return sendSuccess(res, {
    statusCode: 200,
    message: "Capas del usuario listadas correctamente.",
    data: layers,
  });
}

export async function getLayerDetailController(req, res) {
  const layer = await getLayerDetail(req.validated.params.id);
  return sendSuccess(res, {
    statusCode: 200,
    message: "Detalle de capa obtenido correctamente.",
    data: layer,
  });
}

export async function approveLayerController(req, res) {
  const layer = await approveLayer(req.validated.params.id, req.user, req);
  return sendSuccess(res, {
    statusCode: 200,
    message: "Capa aprobada correctamente.",
    data: layer,
  });
}

export async function rejectLayerController(req, res) {
  const layer = await rejectLayer(req.validated.params.id, req.validated.body.reason, req.user, req);
  return sendSuccess(res, {
    statusCode: 200,
    message: "Capa rechazada correctamente.",
    data: layer,
  });
}

export async function publishLayerController(req, res) {
  const layer = await publishLayer(req.validated.params.id, req.validated.body.status, req.user, req);
  return sendSuccess(res, {
    statusCode: 200,
    message: "Estado de publicación actualizado correctamente.",
    data: layer,
  });
}

export async function deleteLayerController(req, res) {
  const layer = await deleteLayer(req.validated.params.id, req.user, req);
  return sendSuccess(res, {
    statusCode: 200,
    message: "Capa eliminada correctamente.",
    data: layer,
  });
}
