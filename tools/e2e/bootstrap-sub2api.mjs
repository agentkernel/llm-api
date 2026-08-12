// 阶段 A：配置 Sub2API（分组、假上游账号、EasyPay 支付、支付配置）。
// 幂等：重复执行会复用同名分组/账号/provider。
import {
  SUB2API,
  FAKE_OPENAI,
  FAKE_EASYPAY,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  EASYPAY_PID,
  EASYPAY_PKEY,
  req,
  saveState,
  log,
  waitFor,
} from "./lib.mjs";

const MODELS = ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];

async function main() {
  log(`waiting for Sub2API at ${SUB2API}`);
  await waitFor(async () => {
    try {
      await req(SUB2API, "/api/v1/auth/login", {
        method: "POST",
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      });
      return true;
    } catch (error) {
      // 登录失败但服务在线也算就绪
      return error.status !== undefined;
    }
  }, { label: "sub2api up", tries: 60 });

  log("admin login");
  const login = await req(SUB2API, "/api/v1/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const adminJWT = login.access_token;
  const authHeaders = { authorization: `Bearer ${adminJWT}` };

  log("accept admin compliance");
  try {
    await req(SUB2API, "/api/v1/admin/compliance/accept", {
      method: "POST",
      headers: authHeaders,
      body: {
        language: "zh",
        phrase: "我已阅读、理解并同意 Sub2API 部署与运营合规承诺",
      },
    });
  } catch (error) {
    // 已确认过会返回错误，忽略
    log(`compliance accept note: ${error.message.slice(0, 120)}`);
  }

  log("regenerate global admin api key");
  const keyResp = await req(SUB2API, "/api/v1/admin/settings/admin-api-key/regenerate", {
    method: "POST",
    headers: authHeaders,
  });
  const adminKey = keyResp.key ?? keyResp.api_key ?? keyResp.admin_api_key;
  if (!adminKey) throw new Error(`no admin key in response: ${JSON.stringify(keyResp)}`);
  const adminHeaders = { "x-api-key": adminKey };

  // ---- group ----
  log("ensure group");
  const groups = await req(SUB2API, "/api/v1/admin/groups/all", { headers: adminHeaders });
  const groupList = Array.isArray(groups) ? groups : groups.items ?? [];
  let group = groupList.find((g) => g.name === "workbuddy-standard");
  if (!group) {
    group = await req(SUB2API, "/api/v1/admin/groups", {
      method: "POST",
      headers: adminHeaders,
      body: {
        name: "workbuddy-standard",
        description: "WorkBuddy 标准分组（e2e）",
        platform: "openai",
        rate_multiplier: 1.0,
        models_list_config: { enabled: true, models: MODELS },
      },
    });
  }
  const groupId = group.id;
  log(`group id=${groupId}`);

  // ---- upstream account (fake openai) ----
  log("ensure upstream account");
  const accounts = await req(SUB2API, "/api/v1/admin/accounts?page=1&page_size=100", {
    headers: adminHeaders,
  });
  const accountList = Array.isArray(accounts) ? accounts : accounts.items ?? [];
  let account = accountList.find((a) => a.name === "workbuddy-fake-upstream");
  const modelMapping = Object.fromEntries(MODELS.map((m) => [m, m]));
  if (!account) {
    account = await req(SUB2API, "/api/v1/admin/accounts", {
      method: "POST",
      headers: adminHeaders,
      body: {
        name: "workbuddy-fake-upstream",
        platform: "openai",
        type: "apikey",
        credentials: {
          api_key: "fake-upstream-key",
          base_url: FAKE_OPENAI,
          model_mapping: modelMapping,
        },
        concurrency: 10,
        priority: 1,
        group_ids: [groupId],
      },
    });
  }
  log(`account id=${account.id}`);

  // ---- easypay provider ----
  log("ensure easypay provider");
  const providers = await req(SUB2API, "/api/v1/admin/payment/providers", { headers: adminHeaders });
  const providerList = Array.isArray(providers) ? providers : providers.items ?? [];
  let provider = providerList.find((p) => p.name === "workbuddy-easypay");
  const providerConfig = {
    pid: EASYPAY_PID,
    pkey: EASYPAY_PKEY,
    apiBase: FAKE_EASYPAY,
    notifyUrl: `${SUB2API}/api/v1/payment/webhook/easypay`,
    returnUrl: `${SUB2API}/payment/result`,
  };
  if (!provider) {
    provider = await req(SUB2API, "/api/v1/admin/payment/providers", {
      method: "POST",
      headers: adminHeaders,
      body: {
        provider_key: "easypay",
        name: "workbuddy-easypay",
        config: providerConfig,
        supported_types: ["alipay", "wxpay"],
        enabled: true,
        payment_mode: "qrcode",
        sort_order: 1,
      },
    });
  } else {
    await req(SUB2API, `/api/v1/admin/payment/providers/${provider.id}`, {
      method: "PUT",
      headers: adminHeaders,
      body: { config: providerConfig, supported_types: ["alipay", "wxpay"], enabled: true, payment_mode: "qrcode" },
    });
  }
  log(`provider id=${provider.id}`);

  // ---- payment config ----
  log("update payment config");
  await req(SUB2API, "/api/v1/admin/payment/config", {
    method: "PUT",
    headers: adminHeaders,
    body: {
      enabled: true,
      balance_disabled: false,
      min_amount: 1,
      max_amount: 100000,
      daily_limit: 0,
      max_pending_orders: 500,
      recharge_fee_rate: 0,
      balance_recharge_multiplier: 1,
      payment_visible_method_alipay_source: "easypay_alipay",
      payment_visible_method_wxpay_source: "easypay_wxpay",
      payment_visible_method_alipay_enabled: true,
      payment_visible_method_wxpay_enabled: true,
    },
  });

  saveState({ adminKey, groupId, accountId: account.id, providerId: provider.id });
  log(`state saved: groupId=${groupId} adminKey=${adminKey.slice(0, 6)}...`);
  log("bootstrap-sub2api done");
}

main().catch((error) => {
  console.error("bootstrap-sub2api FAILED:", error.message);
  if (error.body) console.error(JSON.stringify(error.body).slice(0, 500));
  process.exit(1);
});
