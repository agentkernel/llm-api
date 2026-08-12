import { loadConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import {
  wbCreateDeferredOrder,
  wbFulfillDeferredOrder,
  wbGetDeferredOrder,
  type WBOrderStatus,
} from "../sub2api/serviceClient.js";
import {
  auditEvent,
  ensureApiKey,
  ensureHiddenUser,
  type DeviceRow,
} from "./devices.js";

export interface PackageRow {
  id: number;
  name: string;
  description: string;
  price_cny: string;
  points: string;
  target_group_id: number;
  target_group_name: string;
  enabled: boolean;
  sort_order: number;
}

export interface PurchaseLinkRow {
  id: number;
  device_id: number;
  package_id: number;
  out_trade_no: string;
  sub2api_order_id: number | null;
  payment_type: string;
  amount_cny: string;
  points: string;
  target_group_id: number | null;
  status:
    | "pending"
    | "paid_pending_redeem"
    | "redeeming"
    | "redeemed"
    | "expired"
    | "cancelled"
    | "failed";
}

export class PurchaseError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "PACKAGE_NOT_FOUND"
      | "ORDER_NOT_FOUND"
      | "NOT_PAID"
      | "PROCESSING"
      | "ESCROW_NOT_CONFIGURED"
      | "UPSTREAM_ERROR",
  ) {
    super(message);
    this.name = "PurchaseError";
  }
}

export async function listPackages(): Promise<PackageRow[]> {
  const result = await getPool().query<PackageRow>(
    "SELECT * FROM packages WHERE enabled = true ORDER BY sort_order, id",
  );
  return result.rows;
}

/** Sub2API 订单状态 → 本地 purchase_links 状态。 */
function mapUpstreamStatus(status: string): PurchaseLinkRow["status"] {
  switch (status) {
    case "PENDING":
    case "PAID":
      return "pending";
    case "PAID_PENDING_REDEEM":
      return "paid_pending_redeem";
    case "RECHARGING":
      return "redeeming";
    case "COMPLETED":
      return "redeemed";
    case "EXPIRED":
      return "expired";
    case "CANCELLED":
      return "cancelled";
    default:
      return "failed";
  }
}

export async function createPurchase(
  device: DeviceRow,
  packageId: number,
  paymentType: "alipay" | "wxpay",
  clientIp?: string,
): Promise<{
  outTradeNo: string;
  qrCode: string | null;
  payUrl: string | null;
  amountCny: number;
  points: number;
  expiresAt: string;
}> {
  const config = loadConfig();
  if (!config.ESCROW_USER_ID) {
    throw new PurchaseError("escrow user is not configured", "ESCROW_NOT_CONFIGURED");
  }
  const pool = getPool();
  const packageResult = await pool.query<PackageRow>(
    "SELECT * FROM packages WHERE id = $1 AND enabled = true",
    [packageId],
  );
  const pkg = packageResult.rows[0];
  if (!pkg) throw new PurchaseError("套餐不存在或已下架", "PACKAGE_NOT_FOUND");

  // Sub2API 余额订单的 amount 既是充值到账额度，也是收款基数（1 积分 = 1 元，fee=0）。
  // 因此下单 amount 必须等于套餐积分数，确保到账积分与承诺一致。
  const points = Number(pkg.points);
  const order = await wbCreateDeferredOrder({
    escrowUserId: config.ESCROW_USER_ID,
    amountCny: points,
    paymentType,
    deviceBinding: device.machine_hmac,
    ...(clientIp ? { clientIp } : {}),
  });

  await pool.query(
    `INSERT INTO purchase_links
       (device_id, package_id, out_trade_no, sub2api_order_id, payment_type, amount_cny, points, target_group_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
    [
      device.id,
      pkg.id,
      order.out_trade_no,
      order.order_id,
      paymentType,
      pkg.price_cny,
      pkg.points,
      pkg.target_group_id,
    ],
  );
  await auditEvent("purchase.created", device.id, {
    outTradeNo: order.out_trade_no,
    packageId: pkg.id,
    amountCny: Number(pkg.price_cny),
  });

  return {
    outTradeNo: order.out_trade_no,
    qrCode: order.qr_code ?? null,
    payUrl: order.pay_url ?? null,
    amountCny: order.pay_amount,
    points: Number(pkg.points),
    expiresAt: order.expires_at,
  };
}

async function loadOwnedPurchase(
  device: DeviceRow,
  outTradeNo: string,
): Promise<PurchaseLinkRow> {
  const result = await getPool().query<PurchaseLinkRow>(
    "SELECT * FROM purchase_links WHERE out_trade_no = $1 AND device_id = $2",
    [outTradeNo, device.id],
  );
  const link = result.rows[0];
  if (!link) throw new PurchaseError("订单不存在", "ORDER_NOT_FOUND");
  return link;
}

async function syncLinkStatus(
  link: PurchaseLinkRow,
  upstream: WBOrderStatus,
): Promise<PurchaseLinkRow["status"]> {
  const mapped = mapUpstreamStatus(upstream.status);
  if (mapped !== link.status && link.status !== "redeemed") {
    await getPool().query(
      "UPDATE purchase_links SET status = $1, updated_at = now() WHERE id = $2",
      [mapped, link.id],
    );
  }
  return mapped;
}

export async function getPurchaseStatus(
  device: DeviceRow,
  outTradeNo: string,
): Promise<{ status: PurchaseLinkRow["status"]; points: number; packageId: number }> {
  const link = await loadOwnedPurchase(device, outTradeNo);
  if (link.status === "redeemed") {
    return { status: "redeemed", points: Number(link.points), packageId: link.package_id };
  }
  const upstream = await wbGetDeferredOrder(outTradeNo);
  const status = await syncLinkStatus(link, upstream);
  return { status, points: Number(link.points), packageId: link.package_id };
}

/** 员工在兑换页点击确认后才真正入账。 */
export async function confirmPurchase(
  device: DeviceRow,
  outTradeNo: string,
): Promise<{ points: number; groupId: number | null }> {
  const link = await loadOwnedPurchase(device, outTradeNo);
  if (link.status === "redeemed") {
    return {
      points: Number(link.points),
      groupId: link.target_group_id === null ? null : Number(link.target_group_id),
    };
  }

  let activeDevice = await ensureHiddenUser(device);
  if (!activeDevice.sub2api_user_id) {
    throw new PurchaseError("device user provisioning failed", "UPSTREAM_ERROR");
  }

  await getPool().query(
    "UPDATE purchase_links SET status = 'redeeming', updated_at = now() WHERE id = $1",
    [link.id],
  );

  let upstream: WBOrderStatus;
  try {
    upstream = await wbFulfillDeferredOrder(
      outTradeNo,
      activeDevice.sub2api_user_id,
      activeDevice.machine_hmac,
    );
  } catch (error) {
    // 回滚到可重试状态；具体原因透传给客户端
    await getPool().query(
      "UPDATE purchase_links SET status = 'paid_pending_redeem', updated_at = now() WHERE id = $1 AND status = 'redeeming'",
      [link.id],
    );
    throw error;
  }

  if (upstream.status !== "COMPLETED") {
    await syncLinkStatus(link, upstream);
    throw new PurchaseError(`订单状态异常: ${upstream.status}`, "PROCESSING");
  }

  // pg 将 BIGINT 作为字符串返回，切换 Sub2API 分组前统一转数字。
  const targetGroupId =
    link.target_group_id === null ? null : Number(link.target_group_id);
  activeDevice = await ensureApiKey(activeDevice, targetGroupId);

  await getPool().query(
    `UPDATE purchase_links SET status = 'redeemed', redeemed_at = now(), updated_at = now() WHERE id = $1`,
    [link.id],
  );
  await getPool().query(
    "UPDATE devices SET current_package_id = $1 WHERE id = $2",
    [link.package_id, activeDevice.id],
  );
  await auditEvent("purchase.redeemed", activeDevice.id, {
    outTradeNo,
    points: Number(link.points),
    groupId: targetGroupId,
  });

  return { points: Number(link.points), groupId: targetGroupId };
}

export async function listDevicePurchases(device: DeviceRow): Promise<PurchaseLinkRow[]> {
  const result = await getPool().query<PurchaseLinkRow>(
    "SELECT * FROM purchase_links WHERE device_id = $1 ORDER BY created_at DESC LIMIT 50",
    [device.id],
  );
  return result.rows;
}
