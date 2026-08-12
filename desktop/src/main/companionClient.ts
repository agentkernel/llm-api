import { app } from "electron";
import { getDeviceToken } from "./secureStore";

/**
 * 业务服务地址：生产构建使用固定地址（发布前替换），开发模式允许
 * WB_COMPANION_URL 环境变量覆盖。员工在界面上无法查看或修改。
 */
const PRODUCTION_COMPANION_URL = "https://assistant.ziyouxie.online";

export function companionBaseUrl(): string {
  if (!app.isPackaged && process.env.WB_COMPANION_URL) {
    return process.env.WB_COMPANION_URL;
  }
  return PRODUCTION_COMPANION_URL;
}

export class CompanionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "CompanionError";
  }
}

export async function companionRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    auth?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const { method = "GET", body, auth = true, timeoutMs = 20_000 } = options;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (auth) {
    const token = getDeviceToken();
    if (!token) throw new CompanionError("设备尚未注册", 401, "NO_DEVICE_TOKEN");
    headers["x-device-token"] = token;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(new URL(path, companionBaseUrl()), {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new CompanionError(
      `无法连接服务：${(error as Error).message}`,
      0,
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const err = payload as { code?: string; message?: string } | null;
    throw new CompanionError(
      err?.message ?? `请求失败 (${response.status})`,
      response.status,
      err?.code ?? "HTTP_ERROR",
    );
  }
  return payload as T;
}
