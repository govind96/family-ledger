import { randomBytes } from "node:crypto";

export function secureRandomHex(byteLength: number): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 16) {
    throw new Error("INVALID_RANDOM_BYTE_LENGTH");
  }

  return Array.from(randomBytes(byteLength), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
