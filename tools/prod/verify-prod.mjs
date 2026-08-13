// 生产环境端到端验收：设备注册 → 兑换码激活 → 模型目录/网关模型 → 真实上游对话 → 扣费与用量核对。
// 只走对外 HTTP 接口，不读数据库，可在局域网任意机器上执行。
//
// 用法：
//   WB_COMPANION=http://<ip>:8720 WB_SUB2API=http://<ip>:18080 \
//   WB_REDEEM_CODE=<32位兑换码> node tools/prod/verify-prod.mjs
//
// 可选：WB_EXPECTED_MODELS（默认 deepseek-v4-flash,deepseek-v4-pro）、WB_EXPECTED_POINTS（默认 100）、
//       WB_CHAT_MODEL（默认 deepseek-v4-flash）、WB_MAX_TOKENS（默认 40）。

const COMPANION = process.env.WB_COMPANION ?? "http://127.0.0.1:8720";
const SUB2API = process.env.WB_SUB2API ?? "http://127.0.0.1:18080";
const REDEEM_CODE = process.env.WB_REDEEM_CODE;
const EXPECTED_MODELS = (process.env.WB_EXPECTED_MODELS ?? "deepseek-v4-flash,deepseek-v4-pro")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const EXPECTED_POINTS = Number(process.env.WB_EXPECTED_POINTS ?? 100);
const CHAT_MODEL = process.env.WB_CHAT_MODEL ?? "deepseek-v4-flash";
const MAX_TOKENS = Number(process.env.WB_MAX_TOKENS ?? 40);
const MACHINE_ID = process.env.WB_MACHINE_ID ?? `win:prod-verify-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failures.push(`${name} ${detail}`);
    console.log(`  \u2717 ${name} ${detail}`);
  }
}

function log(message) {
  console.log(`[verify] ${message}`);
}

async function http(base, path, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(new URL(path, base), {
    method,
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${String(text).slice(0, 300)}`);
  }
  return parsed;
}

async function main() {
  if (!REDEEM_CODE) throw new Error("缺少 WB_REDEEM_CODE");

  log("1) 健康检查");
  const health = await http(SUB2API, "/health");
  check("Sub2API /health 正常", JSON.stringify(health).includes("ok") || health?.status === "ok", JSON.stringify(health).slice(0, 120));
  const healthz = await http(COMPANION, "/healthz");
  check("companion /healthz 正常", healthz?.ok === true, JSON.stringify(healthz));

  log("2) 设备注册");
  const reg = await http(COMPANION, "/api/client/devices/register", {
    method: "POST",
    body: { machineId: MACHINE_ID, appVersion: "prod-verify" },
  });
  const auth = { "x-device-token": reg.deviceToken };
  check("设备注册返回令牌", typeof reg.deviceToken === "string" && reg.deviceToken.length > 0);
  check("新设备未激活", reg.activated === false, JSON.stringify(reg));

  log("3) 兑换码激活");
  const redeem = await http(COMPANION, "/api/client/redeem", {
    method: "POST",
    headers: auth,
    body: { code: REDEEM_CODE },
  });
  check(`兑换到账 ${EXPECTED_POINTS} 积分`, Number(redeem.points) === EXPECTED_POINTS, JSON.stringify(redeem));

  const stateAfterRedeem = await http(COMPANION, "/api/client/state", { headers: auth });
  check("激活状态为 true", stateAfterRedeem.activated === true, JSON.stringify(stateAfterRedeem));
  const pointsBefore = Number(stateAfterRedeem.points);
  check(`当前积分 = ${EXPECTED_POINTS}`, pointsBefore === EXPECTED_POINTS, `points=${pointsBefore}`);

  log("4) 模型目录与网关模型列表");
  const catalog = await http(COMPANION, "/api/client/catalog", { headers: auth });
  const catalogIds = (catalog.models ?? []).map((m) => m.modelId).sort();
  check(
    `目录恰好包含 ${EXPECTED_MODELS.length} 个模型`,
    catalogIds.length === EXPECTED_MODELS.length && EXPECTED_MODELS.every((m) => catalogIds.includes(m)),
    catalogIds.join(","),
  );
  check("目录 gatewayUrl 以 /v1 结尾", String(catalog.gatewayUrl).endsWith("/v1"), catalog.gatewayUrl);

  const material = await http(COMPANION, "/api/client/config-material", { headers: auth });
  check("配置材料返回 apiKey", typeof material.apiKey === "string" && material.apiKey.startsWith("sk-"));

  const gwModels = await http(material.gatewayUrl, "/models", {
    headers: { authorization: `Bearer ${material.apiKey}` },
  });
  const gwIds = (gwModels.data ?? []).map((m) => m.id).sort();
  check(
    `网关恰好返回 ${EXPECTED_MODELS.length} 个模型`,
    gwIds.length === EXPECTED_MODELS.length && EXPECTED_MODELS.every((m) => gwIds.includes(m)),
    gwIds.join(","),
  );

  log(`5) 真实上游对话（${CHAT_MODEL}，max_tokens=${MAX_TOKENS}）`);
  const chat = await http(material.gatewayUrl, "/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${material.apiKey}` },
    body: {
      model: CHAT_MODEL,
      messages: [{ role: "user", content: "用一句话说明你是谁" }],
      max_tokens: MAX_TOKENS,
      stream: false,
    },
  });
  const content = chat?.choices?.[0]?.message?.content ?? "";
  check("对话返回内容非空", content.length > 0, JSON.stringify(chat).slice(0, 200));
  check("响应模型为 DeepSeek V4", String(chat?.model ?? "").includes("deepseek"), String(chat?.model));
  const usage = chat?.usage ?? {};
  check("响应含 token 用量", Number(usage.total_tokens ?? 0) > 0, JSON.stringify(usage));

  log("6) 扣费与用量核对");
  // 计费为异步落账，轮询等待余额变化
  let pointsAfter = pointsBefore;
  for (let i = 0; i < 30; i += 1) {
    const state = await http(COMPANION, "/api/client/state", { headers: auth });
    pointsAfter = Number(state.points);
    if (pointsAfter < pointsBefore) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const charged = pointsBefore - pointsAfter;
  check("对话产生扣费", charged > 0, `扣费=${charged.toFixed(8)}`);

  const summary = await http(COMPANION, "/api/client/points/summary?days=7", { headers: auth });
  check("积分明细按模型非空", Array.isArray(summary.models) && summary.models.length > 0, JSON.stringify(summary.models).slice(0, 200));
  check("积分明细按日非空", Array.isArray(summary.daily) && summary.daily.length > 0, JSON.stringify(summary.daily).slice(0, 200));
  check("统计请求数为 1", Number(summary.periodRequests) === 1, `periodRequests=${summary.periodRequests}`);
  const modelStat = (summary.models ?? []).find((m) => m.model === CHAT_MODEL);
  check(`用量统计包含 ${CHAT_MODEL}`, Boolean(modelStat), JSON.stringify(summary.models).slice(0, 200));
  // 扣费口径一致性：余额差额 == 用量统计消耗（8 位小数容差）
  check(
    "扣费与用量统计一致",
    Math.abs(charged - Number(summary.periodUsage)) < 1e-8,
    `余额差额=${charged.toFixed(8)} 用量统计=${Number(summary.periodUsage).toFixed(8)}`,
  );
  check(
    "当前积分与统计一致",
    Math.abs(Number(summary.currentPoints) - pointsAfter) < 1e-8,
    `${summary.currentPoints} vs ${pointsAfter}`,
  );

  console.log(`\n[verify] 设备=${reg.deviceUuid ?? MACHINE_ID}`);
  console.log(`[verify] 扣费=${charged.toFixed(8)} 积分，剩余=${pointsAfter.toFixed(8)}`);
  console.log(`[verify] passed=${passed} failed=${failures.length}`);
  if (failures.length) {
    console.log("FAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`verify 失败: ${error.message}`);
  process.exit(1);
});
