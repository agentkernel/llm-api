import { loadConfig } from "../config.js";
import { panelRequest } from "./http.js";

/** 以隐藏用户身份调用 Sub2API 用户 API。access token 仅内存缓存。 */

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface Sub2ApiApiKey {
  id: number;
  key: string;
  name: string;
  group_id: number | null;
  status: string;
}

export interface Sub2ApiProfile {
  id: number;
  balance: number;
  frozen_balance: number;
  total_recharged: number;
}

export interface UsageStats {
  total_requests: number;
  total_cost: number;
  total_actual_cost: number;
  [extra: string]: unknown;
}

export interface UsageTrendPoint {
  date?: string;
  hour?: string;
  requests?: number;
  cost?: number;
  actual_cost?: number;
  [extra: string]: unknown;
}

export interface UsageModelStat {
  model: string;
  requests: number;
  tokens?: number;
  cost?: number;
  actual_cost?: number;
  [extra: string]: unknown;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function base(): string {
  return loadConfig().SUB2API_BASE_URL;
}

export function invalidateUserToken(email: string): void {
  tokenCache.delete(email);
}

async function login(email: string, password: string): Promise<string> {
  const cached = tokenCache.get(email);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }
  const data = await panelRequest<LoginResponse>(base(), "/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
  });
  tokenCache.set(email, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

export interface HiddenUserCredentials {
  email: string;
  password: string;
}

async function userRequest<T>(
  creds: HiddenUserCredentials,
  path: string,
  options: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const token = await login(creds.email, creds.password);
  try {
    return await panelRequest<T>(base(), path, {
      ...options,
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (error) {
    // token 失效重登一次
    if ((error as { status?: number }).status === 401) {
      invalidateUserToken(creds.email);
      const fresh = await login(creds.email, creds.password);
      return panelRequest<T>(base(), path, {
        ...options,
        headers: { authorization: `Bearer ${fresh}` },
      });
    }
    throw error;
  }
}

export async function userRedeem(
  creds: HiddenUserCredentials,
  code: string,
): Promise<{ type: string; value: number }> {
  return userRequest(creds, "/api/v1/redeem", { method: "POST", body: { code } });
}

export async function userProfile(creds: HiddenUserCredentials): Promise<Sub2ApiProfile> {
  return userRequest(creds, "/api/v1/user/profile");
}

export async function userListKeys(creds: HiddenUserCredentials): Promise<Sub2ApiApiKey[]> {
  const data = await userRequest<{ items: Sub2ApiApiKey[] } | Sub2ApiApiKey[]>(
    creds,
    "/api/v1/keys?page=1&page_size=100",
  );
  return Array.isArray(data) ? data : data.items;
}

export async function userCreateKey(
  creds: HiddenUserCredentials,
  name: string,
  groupId?: number,
): Promise<Sub2ApiApiKey> {
  const body: Record<string, unknown> = { name };
  if (groupId) body.group_id = groupId;
  return userRequest(creds, "/api/v1/keys", { method: "POST", body });
}

export async function userUpdateKeyGroup(
  creds: HiddenUserCredentials,
  keyId: number,
  groupId: number,
): Promise<void> {
  await userRequest(creds, `/api/v1/keys/${keyId}`, {
    method: "PUT",
    body: { group_id: groupId },
  });
}

export interface UsageQuery {
  startDate?: string;
  endDate?: string;
  timezone?: string;
}

function usageQueryString(query: UsageQuery): string {
  const params = new URLSearchParams();
  if (query.startDate) params.set("start_date", query.startDate);
  if (query.endDate) params.set("end_date", query.endDate);
  if (query.timezone) params.set("timezone", query.timezone);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function userUsageStats(
  creds: HiddenUserCredentials,
  query: UsageQuery,
): Promise<UsageStats> {
  return userRequest(creds, `/api/v1/usage/stats${usageQueryString(query)}`);
}

export async function userUsageTrend(
  creds: HiddenUserCredentials,
  query: UsageQuery & { granularity?: "day" | "hour" },
): Promise<UsageTrendPoint[]> {
  const params = new URLSearchParams();
  params.set("granularity", query.granularity ?? "day");
  if (query.startDate) params.set("start_date", query.startDate);
  if (query.endDate) params.set("end_date", query.endDate);
  if (query.timezone) params.set("timezone", query.timezone);
  const data = await userRequest<UsageTrendPoint[] | { items: UsageTrendPoint[] }>(
    creds,
    `/api/v1/usage/dashboard/trend?${params.toString()}`,
  );
  return Array.isArray(data) ? data : data.items;
}

export async function userUsageModels(
  creds: HiddenUserCredentials,
  query: UsageQuery,
): Promise<UsageModelStat[]> {
  const data = await userRequest<UsageModelStat[] | { items: UsageModelStat[] }>(
    creds,
    `/api/v1/usage/dashboard/models${usageQueryString(query)}`,
  );
  return Array.isArray(data) ? data : data.items;
}
