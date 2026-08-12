import { loadConfig } from "../config.js";
import { panelRequest } from "./http.js";

export interface Sub2ApiUser {
  id: number;
  email: string;
  username?: string;
  balance: number;
  status: string;
}

export interface Sub2ApiGroup {
  id: number;
  name: string;
  platform?: string;
  status: string;
  is_exclusive?: boolean;
}

export interface Sub2ApiRedeemCode {
  id: number;
  code: string;
  type: string;
  value: number;
  status: string;
}

function adminHeaders(): Record<string, string> {
  return { "x-api-key": loadConfig().SUB2API_ADMIN_KEY };
}

function base(): string {
  return loadConfig().SUB2API_BASE_URL;
}

/** 创建设备隐藏用户（随机内部邮箱+密码，由调用方生成并信封加密保存）。 */
export async function adminCreateUser(email: string, password: string): Promise<Sub2ApiUser> {
  return panelRequest<Sub2ApiUser>(base(), "/api/v1/admin/users", {
    method: "POST",
    headers: adminHeaders(),
    body: { email, password, notes: "workbuddy-device" },
  });
}

export async function adminGetUser(userId: number): Promise<Sub2ApiUser> {
  return panelRequest<Sub2ApiUser>(base(), `/api/v1/admin/users/${userId}`, {
    headers: adminHeaders(),
  });
}

export async function adminListGroups(): Promise<Sub2ApiGroup[]> {
  const data = await panelRequest<Sub2ApiGroup[] | { items: Sub2ApiGroup[] }>(
    base(),
    "/api/v1/admin/groups/all",
    { headers: adminHeaders() },
  );
  return Array.isArray(data) ? data : data.items;
}

/** 生成 balance 兑换码（value 单位与 balance 一致，即“积分”）。 */
export async function adminGenerateRedeemCodes(
  count: number,
  value: number,
  expiresInDays?: number,
): Promise<Sub2ApiRedeemCode[]> {
  const body: Record<string, unknown> = { count, type: "balance", value };
  if (expiresInDays && expiresInDays > 0) body.expires_in_days = expiresInDays;
  return panelRequest<Sub2ApiRedeemCode[]>(base(), "/api/v1/admin/redeem-codes/generate", {
    method: "POST",
    headers: adminHeaders(),
    body,
  });
}

/** 异常修复：创建并直接兑换到指定用户（幂等，需稳定 code + Idempotency-Key）。 */
export async function adminCreateAndRedeem(
  code: string,
  value: number,
  userId: number,
  notes: string,
): Promise<Sub2ApiRedeemCode> {
  const data = await panelRequest<{ redeem_code: Sub2ApiRedeemCode }>(
    base(),
    "/api/v1/admin/redeem-codes/create-and-redeem",
    {
      method: "POST",
      headers: { ...adminHeaders(), "Idempotency-Key": code },
      body: { code, type: "balance", value, user_id: userId, notes },
    },
  );
  return data.redeem_code;
}
