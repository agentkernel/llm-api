/** Sub2API 面板 API 通用响应包装。 */
export interface PanelEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export class Sub2ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason: string = "",
  ) {
    super(message);
    this.name = "Sub2ApiError";
  }
}

export interface PanelRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  /** 超时毫秒数，默认 15s。 */
  timeoutMs?: number;
}

/** 调用面板 API 并拆开 {code,message,data} 包装；非 0 code 一律抛错。 */
export async function panelRequest<T>(
  baseUrl: string,
  path: string,
  options: PanelRequestOptions = {},
): Promise<T> {
  const { method = "GET", headers = {}, body, timeoutMs = 15_000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...headers,
      },
      body: body === undefined ? null : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Sub2ApiError(
      `sub2api request failed: ${(error as Error).message}`,
      0,
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timer);
  }

  let payload: PanelEnvelope<T> | null = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text) as PanelEnvelope<T>;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new Sub2ApiError(
      payload?.message ?? `sub2api http ${response.status}`,
      response.status,
      payload ? String(payload.code) : "HTTP_ERROR",
    );
  }
  if (!payload || payload.code !== 0) {
    throw new Sub2ApiError(
      payload?.message ?? "sub2api malformed response",
      response.status,
      payload ? String(payload.code) : "MALFORMED",
    );
  }
  return payload.data;
}
