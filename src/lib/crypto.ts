import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function key() {
  const secret = process.env.FIELD_ENCRYPTION_KEY;
  if (secret) return createHash("sha256").update(secret).digest();
  if (process.env.NODE_ENV === "production") throw new Error("FIELD_ENCRYPTION_KEY is required in production");
  return null;
}

/** AES-256-GCM for the most sensitive columns. Without a key in development the value stays plain. */
export function seal(value: string): string;
export function seal(value: string | null | undefined): string | null;
export function seal(value: string | null | undefined) {
  if (!value) return value ?? null;
  const secret = key();
  if (!secret) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** Values written before encryption was enabled carry no prefix and pass through. */
export function unseal(value: string | null | undefined) {
  if (!value || !value.startsWith(PREFIX)) return value ?? null;
  const secret = key();
  if (!secret) throw new Error("FIELD_ENCRYPTION_KEY is required to read encrypted fields");
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", secret, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export const maskId = (value: string | null) => (value ? `••••••${value.slice(-4)}` : null);
