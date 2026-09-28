import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CredentialCryptoError, decryptSecret, encryptSecret, keyringFromEnv, needsReencryption, signToken, verifyToken } from "./crypto";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const ring1 = keyringFromEnv({ CREDENTIALS_ENCRYPTION_KEY: k1 });

describe("encryptSecret / decryptSecret", () => {
  it("round-trips", () => {
    const { ciphertext, keyVersion } = encryptSecret("abcd efgh ijkl mnop", "acct-1", ring1);
    expect(keyVersion).toBe(1);
    expect(ciphertext.startsWith("v1:")).toBe(true);
    expect(ciphertext).not.toContain("abcd");
    expect(decryptSecret(ciphertext, "acct-1", ring1)).toBe("abcd efgh ijkl mnop");
  });

  it("uses a fresh IV every time", () => {
    const a = encryptSecret("same", "acct-1", ring1).ciphertext;
    const b = encryptSecret("same", "acct-1", ring1).ciphertext;
    expect(a).not.toBe(b);
  });

  it("refuses a ciphertext moved to another row (AAD mismatch)", () => {
    const { ciphertext } = encryptSecret("secret", "acct-1", ring1);
    expect(() => decryptSecret(ciphertext, "acct-2", ring1)).toThrow(CredentialCryptoError);
  });

  it("detects tampering", () => {
    const { ciphertext } = encryptSecret("secret", "acct-1", ring1);
    const parts = ciphertext.split(":");
    const data = Buffer.from(parts[3]!, "base64");
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString("base64");
    expect(() => decryptSecret(parts.join(":"), "acct-1", ring1)).toThrow("Unable to decrypt credential");
  });

  it("rejects the wrong key", () => {
    const { ciphertext } = encryptSecret("secret", "acct-1", ring1);
    const other = keyringFromEnv({ CREDENTIALS_ENCRYPTION_KEY: k2 });
    expect(() => decryptSecret(ciphertext, "acct-1", other)).toThrow(CredentialCryptoError);
  });

  it("rejects malformed input", () => {
    expect(() => decryptSecret("nope", "a", ring1)).toThrow("Malformed ciphertext");
    expect(() => decryptSecret("x1:a:b:c", "a", ring1)).toThrow("Malformed ciphertext");
  });
});

describe("key rotation", () => {
  it("decrypts old ciphertexts with a retired key and encrypts new ones with the current key", () => {
    const old = encryptSecret("secret", "acct-1", ring1).ciphertext;
    const ring2 = keyringFromEnv({
      CREDENTIALS_ENCRYPTION_KEY: k2,
      CREDENTIALS_ENCRYPTION_KEY_VERSION: "2",
      CREDENTIALS_ENCRYPTION_KEY_V1: k1,
    });
    expect(decryptSecret(old, "acct-1", ring2)).toBe("secret");
    expect(needsReencryption(old, ring2)).toBe(true);

    const fresh = encryptSecret("secret", "acct-1", ring2);
    expect(fresh.keyVersion).toBe(2);
    expect(needsReencryption(fresh.ciphertext, ring2)).toBe(false);
  });

  it("fails clearly when a referenced key version is missing", () => {
    const old = encryptSecret("secret", "acct-1", ring1).ciphertext;
    const ring2only = keyringFromEnv({ CREDENTIALS_ENCRYPTION_KEY: k2, CREDENTIALS_ENCRYPTION_KEY_VERSION: "2" });
    expect(() => decryptSecret(old, "acct-1", ring2only)).toThrow("No key configured for version 1");
  });
});

describe("keyringFromEnv", () => {
  it("requires a key", () => {
    expect(() => keyringFromEnv({})).toThrow("CREDENTIALS_ENCRYPTION_KEY is not set");
  });

  it("requires 32-byte keys", () => {
    expect(() => keyringFromEnv({ CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/32 bytes/);
  });

  it("validates the version", () => {
    expect(() => keyringFromEnv({ CREDENTIALS_ENCRYPTION_KEY: k1, CREDENTIALS_ENCRYPTION_KEY_VERSION: "0" })).toThrow();
  });
});


describe("signToken / verifyToken", () => {
  const secret = "0123456789abcdef-secret";
  it("round-trips and rejects forgeries", () => {
    const t = signToken("send:abc", secret);
    expect(verifyToken(t, secret)).toBe("send:abc");
    expect(verifyToken(t, "another-secret-value!!")).toBeNull();
    expect(verifyToken(t.replace(/^./, "x"), secret)).toBeNull();
    expect(verifyToken("garbage", secret)).toBeNull();
  });
});
