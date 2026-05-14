import bcrypt from "bcryptjs";
import { env } from "../../config/env.js";

export function hashPassword(value) {
  return bcrypt.hash(value, env.BCRYPT_SALT_ROUNDS);
}

export function verifyPassword(value, hash) {
  return bcrypt.compare(value, hash);
}
