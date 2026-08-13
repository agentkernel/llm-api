// 生产环境 Sub2API 一次性初始化：管理员合规确认、Admin Key、分组、上游账号、渠道定价、支付并发配置。
// 幂等：重复执行复用同名分组/账号/渠道，只补齐缺失项。
//
// 用法（在能访问 Sub2API 的机器上执行）：
//   SUB2API_BASE_URL=http://127.0.0.1:18080 \
//   ADMIN_EMAIL=admin@wb.local ADMIN_PASSWORD=... DEEPSEEK_API_KEY=sk-... \
//   node tools/prod/bootstrap-sub2api-prod.mjs --out /opt/wb/.sub2api-bootstrap.json
//
// 密钥只写入 --out 指定的文件（0600），stdout 一律掩码输出。
import { writeFileSync, chmodSync } from "node:fs";

const BASE = process.env.SUB2API_BASE_URL ?? "http://127.0.0.1:18080";
const ADMIN_EMAIL = requireEnv("ADMIN_EMAIL");
const ADMIN_PASSWORD = requireEnv("ADMIN_PASSWORD");
const DEEPSEEK_API_KEY = requireEnv("DEEPSEEK_API_KEY");
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

const GROUP_NAME = process.env.WB_GROUP_NAME ?? "workbuddy-standard";
const ACCOUNT_NAME = process.env.WB_ACCOUNT_NAME ?? "workbuddy-deepseek";
const CHANNEL_NAME = process.env.WB_CHANNEL_NAME ?? "workbuddy-deepseek-pricing";

// 上线新模型时三处必须同步：账号 model_mapping、渠道 model_pricing.models、companion 目录。
const MODELS = (process.env.WB_MODELS ?? "deepseek-v4-flash,deepseek-v4-pro")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

// USD per token，与 DeepSeek 官方价一致
const PRICING = {
  input_price: Number(process.env.WB_PRICE_INPUT ?? 2.8e-7),
  output_price: Number(process.env.WB_PRICE_OUTPUT ?? 4.2e-7),
  cache_read_price: Number(process.env.WB_PRICE_CACHE_READ ?? 2.8e-8),
  cache_write_price: Number(process.env.WB_PRICE_CACHE_WRITE ?? 0),
};

const outFile = argValue("--out");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
}

function mask(value) {
  if (!value) return "(空)";
  const text = String(value);
  return text.length <= 10 ? "***" : `${text.slice(0, 4)}***${text.slice(-4)}（${text.length} 字符）`;
}

function log(message) {
  console.log(`[bootstrap] ${message}`);
}

async function req(path, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(new URL(path, BASE), {
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
    const error = new Error(`${method} ${path} -> ${res.status}: ${String(text).slice(0, 300)}`);
    error.status = res.status;
    throw error;
  }
  // 面板包装 {code,message,data}
  if (parsed && typeof parsed === "object" && "code" in parsed && "data" in parsed) {
    if (parsed.code !== 0) throw new Error(`${method} ${path} panel code ${parsed.code}: ${parsed.message}`);
    return parsed.data;
  }
  return parsed;
}

async function waitForHealth() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(new URL("/health", BASE));
      if (res.ok) return;
    } catch {
      /* 重试 */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Sub2API 在 ${BASE} 未就绪`);
}

function asList(data) {
  if (Array.isArray(data)) return data;
  return data?.items ?? [];
}

async function main() {
  log(`目标 Sub2API: ${BASE}`);
  await waitForHealth();

  log("管理员登录");
  const login = await req("/api/v1/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const jwtHeaders = { authorization: `Bearer ${login.access_token}` };

  log("确认管理合规声明");
  try {
    await req("/api/v1/admin/compliance/accept", {
      method: "POST",
      headers: jwtHeaders,
      body: { language: "zh", phrase: "我已阅读、理解并同意 Sub2API 部署与运营合规承诺" },
    });
  } catch (error) {
    log(`合规声明已确认过，跳过（${String(error.message).slice(0, 80)}）`);
  }

  log("生成全局 Admin Key");
  const keyResp = await req("/api/v1/admin/settings/admin-api-key/regenerate", {
    method: "POST",
    headers: jwtHeaders,
  });
  const adminKey = keyResp.key ?? keyResp.api_key ?? keyResp.admin_api_key;
  if (!adminKey) throw new Error("响应中没有 Admin Key");
  const adminHeaders = { "x-api-key": adminKey };
  log(`Admin Key: ${mask(adminKey)}`);

  log(`确保分组 ${GROUP_NAME}`);
  const groups = asList(await req("/api/v1/admin/groups/all", { headers: adminHeaders }));
  let group = groups.find((g) => g.name === GROUP_NAME);
  if (!group) {
    group = await req("/api/v1/admin/groups", {
      method: "POST",
      headers: adminHeaders,
      body: {
        name: GROUP_NAME,
        description: "WorkBuddy 标准分组",
        platform: "openai",
        rate_multiplier: 1.0,
        models_list_config: { enabled: true, models: MODELS },
      },
    });
  }
  log(`分组 id=${group.id}`);

  log(`确保上游账号 ${ACCOUNT_NAME}`);
  const accounts = asList(await req("/api/v1/admin/accounts?page=1&page_size=100", { headers: adminHeaders }));
  let account = accounts.find((a) => a.name === ACCOUNT_NAME);
  // model_mapping 非空即该账号的模型白名单，是多上游隔离的唯一手段（恒等映射）
  const modelMapping = Object.fromEntries(MODELS.map((m) => [m, m]));
  const credentials = {
    api_key: DEEPSEEK_API_KEY,
    base_url: DEEPSEEK_BASE_URL,
    model_mapping: modelMapping,
  };
  if (!account) {
    account = await req("/api/v1/admin/accounts", {
      method: "POST",
      headers: adminHeaders,
      body: {
        name: ACCOUNT_NAME,
        platform: "openai",
        type: "apikey",
        credentials,
        concurrency: 10,
        priority: 1,
        group_ids: [group.id],
      },
    });
  } else {
    await req(`/api/v1/admin/accounts/${account.id}`, {
      method: "PUT",
      headers: adminHeaders,
      body: { credentials, group_ids: [group.id] },
    });
  }
  log(`上游账号 id=${account.id} base_url=${DEEPSEEK_BASE_URL} key=${mask(DEEPSEEK_API_KEY)}`);
  log(`模型白名单: ${MODELS.join(", ")}`);

  log(`确保渠道定价 ${CHANNEL_NAME}`);
  const channels = asList(await req("/api/v1/admin/channels?page=1&page_size=100", { headers: adminHeaders }));
  let channel = channels.find((c) => c.name === CHANNEL_NAME);
  const modelPricing = [
    {
      platform: "openai",
      models: MODELS,
      billing_mode: "token",
      ...PRICING,
    },
  ];
  if (!channel) {
    channel = await req("/api/v1/admin/channels", {
      method: "POST",
      headers: adminHeaders,
      body: {
        name: CHANNEL_NAME,
        description: "WorkBuddy DeepSeek 渠道定价",
        group_ids: [group.id],
        model_pricing: modelPricing,
      },
    });
  } else {
    await req(`/api/v1/admin/channels/${channel.id}`, {
      method: "PUT",
      headers: adminHeaders,
      body: { group_ids: [group.id], model_pricing: modelPricing },
    });
  }
  log(`渠道 id=${channel.id}，计价模型: ${MODELS.join(", ")}`);

  // 所有购买订单挂同一 escrow 用户，必须放开并发与日限额，否则会被误限流
  log("更新支付并发配置（escrow 托管）");
  await req("/api/v1/admin/payment/config", {
    method: "PUT",
    headers: adminHeaders,
    body: {
      enabled: process.env.WB_PAYMENT_ENABLED === "true",
      balance_disabled: false,
      min_amount: 1,
      max_amount: 100000,
      daily_limit: 0,
      max_pending_orders: 500,
      recharge_fee_rate: 0,
      balance_recharge_multiplier: 1,
    },
  });

  const summary = {
    baseUrl: BASE,
    adminEmail: ADMIN_EMAIL,
    groupId: group.id,
    groupName: GROUP_NAME,
    accountId: account.id,
    accountName: ACCOUNT_NAME,
    channelId: channel.id,
    channelName: CHANNEL_NAME,
    models: MODELS,
    pricing: PRICING,
    adminKey,
  };
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(summary, null, 2), "utf8");
    chmodSync(outFile, 0o600);
    log(`初始化结果已写入 ${outFile}（含 Admin Key，权限 600）`);
  }
  console.log(
    JSON.stringify({ ...summary, adminKey: mask(adminKey) }, null, 2),
  );
  log("bootstrap 完成");
}

main().catch((error) => {
  console.error(`bootstrap 失败: ${error.message}`);
  process.exit(1);
});
