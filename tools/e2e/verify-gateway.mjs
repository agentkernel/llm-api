// 独立验证：用隐藏用户创建 key、切分组，直接打网关 /v1/models 和 /v1/chat/completions。
import { SUB2API, req, loadState, log, check, summary } from "./lib.mjs";

async function main() {
  const state = loadState();
  const adminHeaders = { "x-api-key": state.adminKey };

  // 建一个临时用户
  const email = `gwtest-${Date.now()}@wb-device.internal`;
  const password = "Gw-test-pass-2026";
  const user = await req(SUB2API, "/api/v1/admin/users", {
    method: "POST",
    headers: adminHeaders,
    body: { email, password },
  });
  log(`temp user id=${user.id}`);

  const login = await req(SUB2API, "/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
  });
  const userHeaders = { authorization: `Bearer ${login.access_token}` };

  const key = await req(SUB2API, "/api/v1/keys", {
    method: "POST",
    headers: userHeaders,
    body: { name: "gw-test", group_id: state.groupId },
  });
  log(`temp key id=${key.id}`);

  // 给用户充值，才能通过余额校验（网关 /v1/models 也要求余额）
  await req(SUB2API, `/api/v1/admin/users/${user.id}/balance`, {
    method: "POST",
    headers: { ...adminHeaders, "Idempotency-Key": `gwtest-topup-${user.id}` },
    body: { balance: 100, operation: "add", notes: "gw test" },
  });

  // 网关 /v1/models
  const modelsResp = await req(SUB2API, "/v1/models", {
    headers: { authorization: `Bearer ${key.key}` },
    raw: true,
  });
  const ids = (modelsResp.data ?? []).map((m) => m.id);
  log(`gateway models: ${ids.join(", ")}`);
  check("gateway returns gpt-5.6", ids.includes("gpt-5.6"), JSON.stringify(ids));
  check("gateway returns all 6 models", ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"].every((m) => ids.includes(m)));

  // 网关 /v1/chat/completions
  try {
    const chat = await req(SUB2API, "/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key.key}` },
      body: { model: "gpt-5.6", messages: [{ role: "user", content: "ping" }], max_tokens: 4, stream: false },
      raw: true,
    });
    const content = chat?.choices?.[0]?.message?.content ?? "";
    check("chat completion returns content", typeof content === "string" && content.length > 0, JSON.stringify(chat).slice(0, 200));
  } catch (error) {
    check("chat completion works", false, error.message.slice(0, 200));
  }

  summary("verify-gateway");
}

main().catch((error) => {
  console.error("verify-gateway FAILED:", error.message);
  if (error.body) console.error(JSON.stringify(error.body).slice(0, 400));
  process.exit(1);
});
