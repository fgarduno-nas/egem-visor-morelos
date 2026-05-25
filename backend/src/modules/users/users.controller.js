import { sendSuccess } from "../../shared/utils/api-response.js";
import {
  changeUserRole,
  createUser,
  listUsers,
  resetUserPassword,
  toggleUser,
  updateUser,
} from "./users.service.js";

export async function createUserController(req, res) {
  const user = await createUser(req.validated.body, req.user, req);
  return sendSuccess(res, {
    statusCode: 201,
    message: "Usuario creado correctamente.",
    data: user,
  });
}

export async function listUsersController(_req, res) {
  const users = await listUsers();
  return sendSuccess(res, {
    statusCode: 200,
    message: "Usuarios listados correctamente.",
    data: users,
  });
}

export async function updateUserController(req, res) {
  const user = await updateUser(req.validated.params.id, req.validated.body, req.user, req);
  return sendSuccess(res, {
    statusCode: 200,
    message: "Usuario actualizado correctamente.",
    data: user,
  });
}

export async function toggleUserController(req, res) {
  const user = await toggleUser(
    req.validated.params.id,
    req.validated.body.isActive,
    req.user,
    req
  );

  return sendSuccess(res, {
    statusCode: 200,
    message: "Estado del usuario actualizado correctamente.",
    data: user,
  });
}

export async function changeRoleController(req, res) {
  const user = await changeUserRole(
    req.validated.params.id,
    req.validated.body.roleCode,
    req.user,
    req
  );

  return sendSuccess(res, {
    statusCode: 200,
    message: "Rol del usuario actualizado correctamente.",
    data: user,
  });
}

export async function resetPasswordController(req, res) {
  const user = await resetUserPassword(
    req.validated.params.id,
    req.validated.body.password,
    req.user,
    req
  );

  return sendSuccess(res, {
    statusCode: 200,
    message: "Contrasena restablecida correctamente.",
    data: user,
  });
}
