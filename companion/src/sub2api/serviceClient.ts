import { loadConfig } from "../config.js";
import { panelRequest } from "./http.js";

/** Sub2API 私有分支的服务间支付接口（x-service-key 认证）。 */

export interface WBCreateOrderResult {
  order_id: number;
  out_trade_no: string;
  amount: number;
  pay_amount: number;
  status: string;
  payment_type: string;
  qr_code?: string;
  pay_url?: string;
  expires_at: string;
}

export interface WBOrderStatus {
  order_id: number;
  out_trade_no: string;
  status:
    | "PENDING"
    | "PAID"
    | "PAID_PENDING_REDEEM"
    | "RECHARGING"
    | "COMPLETED"
    | "EXPIRED"
    | "CANCELLED"
    | "FAILED"
    | string;
  amount: number;
  pay_amount: number;
  device_binding?: string;
  redeemed_to_user_id?: number;
  expires_at: string;
  paid_at?: string;
  completed_at?: string;
}

function serviceHeaders(): Record<string, string> {
  return { "x-service-key": loadConfig().WB_SERVICE_API_KEY };
}

function base(): string {
  return loadConfig().SUB2API_BASE_URL;
}

export async function wbCreateDeferredOrder(input: {
  escrowUserId: number;
  amountCny: number;
  paymentType: "alipay" | "wxpay";
  deviceBinding: string;
  clientIp?: string;
}): Promise<WBCreateOrderResult> {
  return panelRequest<WBCreateOrderResult>(base(), "/api/v1/service/payment/orders", {
    method: "POST",
    headers: serviceHeaders(),
    body: {
      // Sub2API 期望 int64；pg 的 BIGINT 可能读成字符串，强制转数字。
      user_id: Number(input.escrowUserId),
      amount: input.amountCny,
      payment_type: input.paymentType,
      device_binding: input.deviceBinding,
      client_ip: input.clientIp ?? "",
    },
  });
}

export async function wbGetDeferredOrder(outTradeNo: string): Promise<WBOrderStatus> {
  return panelRequest<WBOrderStatus>(
    base(),
    `/api/v1/service/payment/orders/${encodeURIComponent(outTradeNo)}`,
    { headers: serviceHeaders() },
  );
}

export async function wbFulfillDeferredOrder(
  outTradeNo: string,
  userId: number,
  deviceBinding: string,
): Promise<WBOrderStatus> {
  return panelRequest<WBOrderStatus>(
    base(),
    `/api/v1/service/payment/orders/${encodeURIComponent(outTradeNo)}/fulfill`,
    {
      method: "POST",
      headers: { ...serviceHeaders(), "Idempotency-Key": outTradeNo },
      // Sub2API 期望 int64；pg 的 BIGINT 可能读成字符串，强制转数字。
      body: { user_id: Number(userId), device_binding: deviceBinding },
    },
  );
}
