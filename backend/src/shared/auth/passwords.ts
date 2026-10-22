import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${hash.toString("hex")}`;
}
export async function checkPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [kind, salt, expected] = encoded.split("$");
  if (kind !== "scrypt" || !salt || !expected) return false;
  const stored = Buffer.from(expected, "hex");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return stored.length === actual.length && timingSafeEqual(stored, actual);
}
