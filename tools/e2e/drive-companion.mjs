// 阶段 C：模拟桌面端 main 进程，通过 companion HTTP + 网关 + 模拟支付回调跑通全流程。
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  SUB2API,
  COMPANION,
  EASYPAY_PID,
  EASYPAY_PKEY,
  req,
  loadState,
  log,
  check,
  summary,
  waitFor,
} from "./lib.mjs";

// 每次运行使用唯一机器码 → 全新设备，保证断言可重复。
const MACHINE_ID = process.env.E2E_MACHINE_ID ?? `win:e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ALL_MODELS = ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];

function easyPaySign(params, pkey) {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== "")
    .sort();
  const base = keys.map((k) => `${k}=${params[k]}`).join("&") + pkey;
  return createHash("md5").update(base).digest("hex");
}

async function companion(path, opts) {
  return req(COMPANION, path, { ...opts, raw: true });
}

async function main() {
  const state = loadState();
  let deviceToken = null;
  const auth = () => ({ "x-device-token": deviceToken });

  // 1. 设备注册
  log("register device");
  const reg = await companion("/api/client/devices/register", {
    method: "POST",
    body: { machineId: MACHINE_ID, appVersion: "0.1.0-e2e" },
  });
  deviceToken = reg.deviceToken;
  check("device registered with token", typeof deviceToken === "string" && deviceToken.length > 0);
  check("fresh device not activated", reg.activated === false, JSON.stringify(reg));

  // 2. 初始状态
  const state1 = await companion("/api/client/state", { headers: auth() });
  check("state not activated pre-redeem", state1.activated === false);
  check("points null pre-redeem", state1.points === null || state1.points === 0);

  // 3. 兑换公司码（每次运行用新码，避免一次性码复用冲突）
  const companyCode = process.env.E2E_COMPANY_CODE ?? state.companyCode;
  log(`redeem company code ${companyCode}`);
  const redeem = await companion("/api/client/redeem", {
    method: "POST",
    headers: auth(),
    body: { code: companyCode },
  });
  check("redeem returns 100 points", Number(redeem.points) === 100, JSON.stringify(redeem));
  check("redeem returns target group 2", Number(redeem.groupId) === Number(state.groupId), JSON.stringify(redeem));

  // 4. 兑换后状态
  const state2 = await companion("/api/client/state", { headers: auth() });
  check("activated after redeem", state2.activated === true, JSON.stringify(state2));
  check("points ~100 after redeem", Number(state2.points) === 100, JSON.stringify(state2));

  // 5. 幂等：同设备重复兑换同一码 → 仍成功返回
  const redeemAgain = await companion("/api/client/redeem", {
    method: "POST",
    headers: auth(),
    body: { code: companyCode },
  });
  check("redeem idempotent (same device)", Number(redeemAgain.points) === 100);

  // 6. 目录 + 配置材料 + 网关模型（桌面端 fetchModels 逻辑）
  const catalog = await companion("/api/client/catalog", { headers: auth() });
  check("catalog has 6 models", (catalog.models ?? []).length === 6, `${(catalog.models ?? []).length}`);
  check("catalog gatewayUrl ends with /v1", String(catalog.gatewayUrl).endsWith("/v1"));

  const material = await companion("/api/client/config-material", { headers: auth() });
  check("config-material returns apiKey", typeof material.apiKey === "string" && material.apiKey.startsWith("sk-"), material.apiKey?.slice(0, 6));
  check("config-material gatewayUrl ends with /v1", String(material.gatewayUrl).endsWith("/v1"));

  // 直接打网关 /v1/models（模拟桌面 main 拉取）
  const gwModels = await req(material.gatewayUrl, "/models", {
    headers: { authorization: `Bearer ${material.apiKey}` },
    raw: true,
  });
  const gwIds = (gwModels.data ?? []).map((m) => m.id);
  check("gateway lists all 6 models", ALL_MODELS.every((m) => gwIds.includes(m)), gwIds.join(","));

  // 交集（目录 ∩ 网关）→ 生成 models.json 条目（桌面 applyModels 逻辑镜像）
  const catalogIds = new Set(catalog.models.map((m) => m.modelId));
  const intersection = gwIds.filter((id) => catalogIds.has(id));
  check("intersection equals 6", intersection.length === 6, `${intersection.length}`);

  const entries = catalog.models
    .filter((m) => intersection.includes(m.modelId))
    .map((m) => {
      const e = {
        id: m.modelId,
        name: m.displayName,
        vendor: m.vendor,
        url: material.gatewayUrl,
        apiKey: material.apiKey,
        supportsToolCall: m.supportsToolCall,
        supportsImages: m.supportsImages,
        supportsReasoning: m.supportsReasoning,
        useCustomProtocol: m.useCustomProtocol,
      };
      if (m.maxInputTokens) e.maxInputTokens = m.maxInputTokens;
      if (m.reasoning) e.reasoning = m.reasoning;
      return e;
    });
  const artifactPath = "D:/workbuddy-model-assistant/.local/generated-models.json";
  writeFileSync(artifactPath, JSON.stringify(entries, null, 2), "utf8");
  check("generated models.json has 6 entries with id/url/apiKey", entries.length === 6 && entries.every((e) => e.id && e.url.endsWith("/v1") && e.apiKey));
  log(`wrote sample models.json artifact: ${artifactPath}`);

  // 7. 连通测试（桌面 testModel 逻辑）：真实打 /chat/completions
  const chat = await req(material.gatewayUrl, "/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${material.apiKey}` },
    body: { model: "gpt-5.6", messages: [{ role: "user", content: "ping" }], max_tokens: 4, stream: false },
    raw: true,
  });
  check("connectivity test chat returns content", (chat?.choices?.[0]?.message?.content ?? "").length > 0);

  // 8. 购买 → 模拟支付 → 待兑换 → 确认入账
  log("list packages");
  const packages = await companion("/api/client/packages", { headers: auth() });
  check("packages available", packages.length >= 1);
  const pkg = packages[0];

  log("create purchase order");
  const order = await companion("/api/client/purchase/orders", {
    method: "POST",
    headers: auth(),
    body: { packageId: pkg.id, paymentType: "alipay" },
  });
  check("purchase order created with out_trade_no", typeof order.outTradeNo === "string" && order.outTradeNo.length > 0, JSON.stringify(order).slice(0, 200));
  check("purchase returns qr or payurl", Boolean(order.qrCode || order.payUrl), JSON.stringify(order).slice(0, 200));
  check("purchase amount equals package points (1:1)", Number(order.points) === Number(pkg.points), `order.points=${order.points} pkg.points=${pkg.points}`);

  // 初始状态 pending
  const st1 = await companion(`/api/client/purchase/orders/${encodeURIComponent(order.outTradeNo)}`, { headers: auth() });
  check("order pending before payment", st1.status === "pending", st1.status);

  // 模拟 EasyPay 异步回调（签名）
  log("simulate EasyPay payment notify");
  const notifyParams = {
    pid: EASYPAY_PID,
    trade_no: `UP${Date.now()}`,
    out_trade_no: order.outTradeNo,
    type: "alipay",
    name: pkg.name,
    money: Number(pkg.priceCny).toFixed(2),
    trade_status: "TRADE_SUCCESS",
  };
  notifyParams.sign = easyPaySign(notifyParams, EASYPAY_PKEY);
  notifyParams.sign_type = "MD5";
  const notifyQs = new URLSearchParams(notifyParams).toString();
  const notifyResp = await fetch(`${SUB2API}/api/v1/payment/webhook/easypay?${notifyQs}`, { method: "GET" });
  const notifyText = await notifyResp.text();
  check("webhook accepted (success)", notifyText.toLowerCase().includes("success"), `${notifyResp.status} ${notifyText.slice(0, 60)}`);

  // 轮询状态 → paid_pending_redeem
  log("poll for paid_pending_redeem");
  const paidStatus = await waitFor(async () => {
    const s = await companion(`/api/client/purchase/orders/${encodeURIComponent(order.outTradeNo)}`, { headers: auth() });
    return s.status === "paid_pending_redeem" ? s : null;
  }, { label: "paid_pending_redeem", tries: 20, intervalMs: 1000 });
  check("order reaches paid_pending_redeem", paidStatus.status === "paid_pending_redeem", paidStatus.status);

  // 确认兑换前，余额不应因支付而增加（严格延迟入账）。
  // 允许连通测试消耗的极小额度，只要仍在 ~100（未加上购买的 100）即可。
  const stateBeforeConfirm = await companion("/api/client/state", { headers: auth() });
  check("points still ~100 before confirm (deferred, not credited)", Number(stateBeforeConfirm.points) > 99 && Number(stateBeforeConfirm.points) <= 100, JSON.stringify(stateBeforeConfirm));

  // 确认兑换
  log("confirm purchase (redeem to device)");
  const confirm = await companion(`/api/client/purchase/orders/${encodeURIComponent(order.outTradeNo)}/confirm`, {
    method: "POST",
    headers: auth(),
  });
  check("confirm credits 100 points", Number(confirm.points) === 100, JSON.stringify(confirm));

  // 状态 → redeemed
  const st2 = await companion(`/api/client/purchase/orders/${encodeURIComponent(order.outTradeNo)}`, { headers: auth() });
  check("order redeemed after confirm", st2.status === "redeemed", st2.status);

  // 确认幂等：再次确认仍返回成功、不重复入账
  const confirmAgain = await companion(`/api/client/purchase/orders/${encodeURIComponent(order.outTradeNo)}/confirm`, {
    method: "POST",
    headers: auth(),
  });
  check("confirm idempotent", Number(confirmAgain.points) === 100);

  // 9. 积分累计（100 兑换 + 100 购买 = 200，减去极少量对话消耗）
  const finalState = await companion("/api/client/state", { headers: auth() });
  check("points ~200 after purchase", Number(finalState.points) > 199.9 && Number(finalState.points) <= 200.001, JSON.stringify(finalState));

  // 10. 积分统计页
  const points = await companion("/api/client/points/summary?days=30", { headers: auth() });
  check("points summary currentPoints ~200", Number(points.currentPoints) > 199.9, JSON.stringify(points).slice(0, 200));
  check("points summary totalRecharged == 200", Number(points.totalRecharged) === 200, `${points.totalRecharged}`);
  check("points summary models is array", Array.isArray(points.models), typeof points.models);

  summary("drive-companion");
}

main().catch((error) => {
  console.error("drive-companion FAILED:", error.message);
  if (error.body) console.error(JSON.stringify(error.body).slice(0, 500));
  process.exit(1);
});
