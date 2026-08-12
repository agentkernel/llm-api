import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { authenticateDevice, configMaterial, DeviceError, getDeviceById, registerDevice, type DeviceRow } from "./domain/devices.js";
import { listEnabledModelProfiles } from "./domain/catalog.js";
import { confirmPurchase, createPurchase, getPurchaseStatus, listDevicePurchases, listPackages, PurchaseError } from "./domain/purchase.js";
import { redeemCompanyCode, RedeemError } from "./domain/redeem.js";
import { pointsSummary } from "./domain/usage.js";
import { userProfile } from "./sub2api/userClient.js";
import { hiddenUserCredentials } from "./domain/devices.js";
import { Sub2ApiError } from "./sub2api/http.js";

declare module "fastify" {
  interface FastifyRequest {
    device?: DeviceRow;
  }
}

/** 简单的每设备限速（MVP：进程内滑动窗口）。 */
class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly limitPerMinute: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    const entries = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (entries.length >= this.limitPerMinute) {
      this.hits.set(key, entries);
      return false;
    }
    entries.push(now);
    this.hits.set(key, entries);
    return true;
  }
}

function errorReply(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send({ code, message });
}

function mapDomainError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof DeviceError) {
    const status =
      error.code === "INVALID_TOKEN" ? 401 : error.code === "DEVICE_DISABLED" ? 403 : 409;
    return errorReply(reply, status, error.code, error.message);
  }
  if (error instanceof RedeemError) {
    const status = error.code === "CODE_NOT_FOUND" ? 404 : 409;
    return errorReply(reply, status, error.code, error.message);
  }
  if (error instanceof PurchaseError) {
    const status =
      error.code === "PACKAGE_NOT_FOUND" || error.code === "ORDER_NOT_FOUND" ? 404 : 409;
    return errorReply(reply, status, error.code, error.message);
  }
  if (error instanceof Sub2ApiError) {
    // 不向客户端透传上游细节，只给可诊断的分类
    const status = error.status === 409 ? 409 : 502;
    return errorReply(reply, status, "UPSTREAM_ERROR", error.message);
  }
  throw error;
}

export async function buildServer(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "test" ? "silent" : "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers['x-service-key']",
          "req.headers['x-device-token']",
        ],
        censor: "[redacted]",
      },
    },
    trustProxy: true,
  });
  const limiter = new RateLimiter(config.RATE_LIMIT_PER_MINUTE);

  app.get("/healthz", async () => ({ ok: true }));

  // ---- 设备注册（无令牌） ----
  const registerSchema = z.object({
    machineId: z.string().min(8).max(256),
    appVersion: z.string().max(64).optional(),
  });
  app.post("/api/client/devices/register", async (request, reply) => {
    if (!limiter.allow(`register:${request.ip}`)) {
      return errorReply(reply, 429, "RATE_LIMITED", "too many requests");
    }
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return errorReply(reply, 400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "invalid");
    }
    try {
      const result = await registerDevice(parsed.data.machineId);
      return reply.send(result);
    } catch (error) {
      return mapDomainError(reply, error);
    }
  });

  // ---- 设备令牌认证 ----
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/client/") || request.url === "/api/client/devices/register") {
      return;
    }
    const token = request.headers["x-device-token"];
    if (typeof token !== "string" || !token) {
      return errorReply(reply, 401, "MISSING_TOKEN", "x-device-token header required");
    }
    try {
      request.device = await authenticateDevice(token);
    } catch (error) {
      return mapDomainError(reply, error);
    }
  });

  const device = (request: FastifyRequest): DeviceRow => request.device!;

  // ---- 状态与目录 ----
  app.get("/api/client/state", async (request, reply) => {
    const dev = device(request);
    const activated = dev.sub2api_user_id !== null && dev.sealed_api_key !== null;
    let points: number | null = null;
    if (activated) {
      try {
        points = (await userProfile(hiddenUserCredentials(dev))).balance;
      } catch {
        points = null;
      }
    }
    return reply.send({
      deviceUuid: dev.device_uuid,
      activated,
      currentGroupId: dev.current_group_id,
      currentPackageId: dev.current_package_id,
      points,
    });
  });

  app.get("/api/client/catalog", async (_request, reply) => {
    const config2 = loadConfig();
    return reply.send({
      gatewayUrl: config2.GATEWAY_URL,
      models: await listEnabledModelProfiles(),
    });
  });

  // ---- 配置材料（仅 main 进程使用，含原始 key） ----
  app.get("/api/client/config-material", async (request, reply) => {
    try {
      const fresh = await getDeviceById(device(request).id);
      return reply.send(configMaterial(fresh ?? device(request)));
    } catch (error) {
      return mapDomainError(reply, error);
    }
  });

  // ---- 兑换 ----
  const redeemSchema = z.object({ code: z.string().min(6).max(64) });
  app.post("/api/client/redeem", async (request, reply) => {
    const dev = device(request);
    if (!limiter.allow(`redeem:${dev.id}`)) {
      return errorReply(reply, 429, "RATE_LIMITED", "too many redeem attempts");
    }
    const parsed = redeemSchema.safeParse(request.body);
    if (!parsed.success) {
      return errorReply(reply, 400, "INVALID_INPUT", "invalid code");
    }
    try {
      const result = await redeemCompanyCode(dev, parsed.data.code);
      return reply.send(result);
    } catch (error) {
      return mapDomainError(reply, error);
    }
  });

  // ---- 套餐与购买 ----
  app.get("/api/client/packages", async (_request, reply) => {
    const rows = await listPackages();
    return reply.send(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        priceCny: Number(row.price_cny),
        points: Number(row.points),
        targetGroupId: row.target_group_id,
        targetGroupName: row.target_group_name,
      })),
    );
  });

  const purchaseSchema = z.object({
    packageId: z.coerce.number().int().positive(),
    paymentType: z.enum(["alipay", "wxpay"]),
  });
  app.post("/api/client/purchase/orders", async (request, reply) => {
    const dev = device(request);
    if (!limiter.allow(`purchase:${dev.id}`)) {
      return errorReply(reply, 429, "RATE_LIMITED", "too many purchase attempts");
    }
    const parsed = purchaseSchema.safeParse(request.body);
    if (!parsed.success) {
      return errorReply(reply, 400, "INVALID_INPUT", "invalid purchase request");
    }
    try {
      const result = await createPurchase(
        dev,
        parsed.data.packageId,
        parsed.data.paymentType,
        request.ip,
      );
      return reply.send(result);
    } catch (error) {
      return mapDomainError(reply, error);
    }
  });

  app.get("/api/client/purchase/orders", async (request, reply) => {
    const rows = await listDevicePurchases(device(request));
    return reply.send(
      rows.map((row) => ({
        outTradeNo: row.out_trade_no,
        status: row.status,
        amountCny: Number(row.amount_cny),
        points: Number(row.points),
        paymentType: row.payment_type,
      })),
    );
  });

  app.get("/api/client/purchase/orders/:outTradeNo", async (request, reply) => {
    const { outTradeNo } = request.params as { outTradeNo: string };
    try {
      return reply.send(await getPurchaseStatus(device(request), outTradeNo));
    } catch (error) {
      return mapDomainError(reply, error);
    }
  });

  app.post("/api/client/purchase/orders/:outTradeNo/confirm", async (request, reply) => {
    const { outTradeNo } = request.params as { outTradeNo: string };
    try {
      return reply.send(await confirmPurchase(device(request), outTradeNo));
    } catch (error) {
      return mapDomainError(reply, error);
    }
  });

  // ---- 积分统计 ----
  const usageSchema = z.object({
    days: z.coerce.number().refine((d) => [7, 30, 90].includes(d)).default(30),
    timezone: z.string().max(64).default("Asia/Shanghai"),
  });
  app.get("/api/client/points/summary", async (request, reply) => {
    const parsed = usageSchema.safeParse(request.query);
    if (!parsed.success) {
      return errorReply(reply, 400, "INVALID_INPUT", "invalid query");
    }
    try {
      const summary = await pointsSummary(
        device(request),
        parsed.data.days as 7 | 30 | 90,
        parsed.data.timezone,
      );
      return reply.send(summary);
    } catch (error) {
      return mapDomainError(reply, error);
    }
  });

  return app;
}
