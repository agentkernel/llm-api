/** 直连中转站网关：仅 main 进程持有 apiKey。 */

export async function fetchGatewayModelIds(
  gatewayUrl: string,
  apiKey: string,
): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${gatewayUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`网关返回 ${response.status}`);
    }
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    return (payload.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } finally {
    clearTimeout(timer);
  }
}

/** 员工主动触发的连通测试：一次最小 chat 请求，消耗少量积分。 */
export async function testChatCompletion(
  gatewayUrl: string,
  apiKey: string,
  modelId: string,
): Promise<{ ok: boolean; latencyMs: number | null; message: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${gatewayUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 4,
        stream: false,
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const text = await response.text();
      let detail = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        // 保留 HTTP 状态描述
      }
      return { ok: false, latencyMs, message: detail };
    }
    return { ok: true, latencyMs, message: "连通正常" };
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      message: (error as Error).name === "AbortError" ? "请求超时" : (error as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}
