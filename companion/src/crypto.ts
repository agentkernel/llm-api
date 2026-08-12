import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** 机器码规范化后加盐 HMAC，服务端永不保存原始机器标识。 */
export function hmacMachineId(secret: string, rawMachineId: string): string {
  const normalized = rawMachineId.trim().toLowerCase();
  return createHmac("sha256", secret).update(normalized).digest("hex");
}

/** 设备令牌/兑换码等一次性凭证的存储哈希。 */
export function hmacToken(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** AES-256-GCM 信封加密：用于隐藏用户密码、refresh token、apiKey 等落库字段。 */
export function sealSecret(masterKeyHex: string, plaintext: string): string {
  const key = Buffer.from(masterKeyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

export function openSecret(masterKeyHex: string, sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("invalid sealed secret format");
  }
  const [, ivPart, dataPart, tagPart] = parts;
  const key = Buffer.from(masterKeyHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart!, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart!, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart!, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * 公司兑换码使用 Sub2API 生成的 32 位小写十六进制原码。
 * 全链路统一规范化为 trim + 小写；HMAC 与上游提交都必须使用该形式。
 */
export function normalizeRedeemCode(input: string): string {
  return input.trim().toLowerCase();
}
