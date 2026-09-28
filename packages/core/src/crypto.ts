import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * App-level AES-256-GCM for secrets at rest (sending-account app passwords).
 *
 * Ciphertext format:  v<version>:<iv b64>:<auth tag b64>:<data b64>
 *
 * - The key version prefix lets us rotate: new writes use the current key,
 *   old rows stay readable while any key version they reference is configured.
 * - `aad` (additional authenticated data) binds a ciphertext to its row
 *   (we pass the sending account id), so a ciphertext copied onto another
 *   row fails to decrypt instead of silently authenticating as that account.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export type Keyring = {
  currentVersion: number;
  keys: ReadonlyMap<number, Buffer>;
};

export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialCryptoError";
  }
}

function decodeKey(b64: string, label: string): Buffer {
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    throw new CredentialCryptoError(`${label} must be ${KEY_BYTES} bytes, base64-encoded (got ${key.length} bytes)`);
  }
  return key;
}

/**
 * Builds the keyring from environment variables:
 *   CREDENTIALS_ENCRYPTION_KEY          current key (base64, 32 bytes)
 *   CREDENTIALS_ENCRYPTION_KEY_VERSION  its version number (default 1)
 *   CREDENTIALS_ENCRYPTION_KEY_V<n>     retired keys still needed for decryption
 */
export function keyringFromEnv(env: Record<string, string | undefined>): Keyring {
  const current = env.CREDENTIALS_ENCRYPTION_KEY;
  if (!current) throw new CredentialCryptoError("CREDENTIALS_ENCRYPTION_KEY is not set");

  const currentVersion = Number(env.CREDENTIALS_ENCRYPTION_KEY_VERSION ?? "1");
  if (!Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new CredentialCryptoError("CREDENTIALS_ENCRYPTION_KEY_VERSION must be a positive integer");
  }

  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const m = /^CREDENTIALS_ENCRYPTION_KEY_V(\d+)$/.exec(name);
    if (m && value) keys.set(Number(m[1]), decodeKey(value, name));
  }
  keys.set(currentVersion, decodeKey(current, "CREDENTIALS_ENCRYPTION_KEY"));
  return { currentVersion, keys };
}

export function encryptSecret(plaintext: string, aad: string, keyring: Keyring): { ciphertext: string; keyVersion: number } {
  const key = keyring.keys.get(keyring.currentVersion);
  if (!key) throw new CredentialCryptoError(`No key for current version ${keyring.currentVersion}`);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: `v${keyring.currentVersion}:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`,
    keyVersion: keyring.currentVersion,
  };
}

export function decryptSecret(ciphertext: string, aad: string, keyring: Keyring): string {
  const parts = ciphertext.split(":");
  const m = parts.length === 4 ? /^v(\d+)$/.exec(parts[0]!) : null;
  if (!m) throw new CredentialCryptoError("Malformed ciphertext");

  const version = Number(m[1]);
  const key = keyring.keys.get(version);
  if (!key) throw new CredentialCryptoError(`No key configured for version ${version}`);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(parts[1]!, "base64"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(parts[2]!, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3]!, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Never leak details; GCM auth failure means wrong key, wrong row or tampering.
    throw new CredentialCryptoError("Unable to decrypt credential");
  }
}

/** True when a ciphertext should be re-encrypted with the current key. */
export function needsReencryption(ciphertext: string, keyring: Keyring): boolean {
  return !ciphertext.startsWith(`v${keyring.currentVersion}:`);
}

// ---------------------------------------------------------------------------
// Signed tokens (unsubscribe links). Not secret, just unforgeable.
// ---------------------------------------------------------------------------


export function signToken(payload: string, secret: string): string {
  if (!secret || secret.length < 16) throw new CredentialCryptoError("Signing secret must be at least 16 characters");
  const body = Buffer.from(payload, "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url").slice(0, 32);
  return `${body}.${mac}`;
}

/** Returns the payload, or null if the token is malformed or forged. */
export function verifyToken(token: string, secret: string): string | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url").slice(0, 32);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return Buffer.from(body, "base64url").toString("utf8");
}
