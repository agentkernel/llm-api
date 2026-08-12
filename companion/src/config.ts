import { z } from "zod";

// 所有敏感值经环境变量/Docker secret 注入，绝不写入代码或示例文件。
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8720),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Sub2API 面板地址（含协议，不带 /api/v1），例如 https://api.example.com
  SUB2API_BASE_URL: z.string().url(),
  // 推理网关基址（写入 models.json 的 url 字段），必须以 /v1 结尾
  GATEWAY_URL: z
    .string()
    .url()
    .refine((value) => value.endsWith("/v1"), "GATEWAY_URL must end with /v1"),

  // 全局 Admin API Key（仅服务端持有）
  SUB2API_ADMIN_KEY: z.string().min(1),
  // Sub2API 私有分支服务间支付接口密钥（对应 Sub2API 的 WB_SERVICE_API_KEY）
  WB_SERVICE_API_KEY: z.string().min(1),

  // 设备机器码 HMAC 盐 / 数据信封加密主密钥（32 字节 hex）
  DEVICE_HMAC_SECRET: z.string().min(32),
  ENVELOPE_MASTER_KEY_HEX: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENVELOPE_MASTER_KEY_HEX must be 32 bytes hex"),

  // 托管支付订单的 escrow 用户（由 CLI escrow:init 创建后回填）
  ESCROW_USER_ID: z.coerce.number().int().positive().optional(),

  // 隐藏用户邮箱域（内部占位，不需要真实收信）
  HIDDEN_USER_EMAIL_DOMAIN: z.string().default("wb-device.internal"),

  // 兑换/注册等接口的限速（每设备每分钟）
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}
