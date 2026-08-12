/**
 * WorkBuddy companion 管理 CLI。
 *
 * 用法：npm run cli -- <命令> [参数]
 *
 * 命令：
 *   doctor                                        检查配置与 Sub2API 连通性
 *   escrow:init                                   创建支付托管用户（输出 ESCROW_USER_ID）
 *   packages:add --name N --price 100 --group 2 [--points 100] [--group-name 名称] [--desc 描述] [--sort 0]
 *       (当前计费模型：1 积分 = 1 元，points 省略时默认等于 price，且必须与 price 相等)
 *   packages:list
 *   packages:set-enabled --id 1 --enabled true|false
 *   catalog:import --file catalog.json            导入/更新模型能力目录
 *   catalog:list
 *   codes:generate --points 100 [--count 10] [--package 1] [--group 2] [--expires-days 90] [--label 批次]
 *   codes:void --code <32位hex兑换码>
 *   devices:list [--limit 50]
 *   devices:find --uuid <device_uuid>
 *   devices:disable --uuid <device_uuid>
 *   devices:migrate --from <device_uuid> --machine-id <新机器原始ID>
 *   orders:repair --out-trade-no <编号>           对已支付未兑换订单重试履约
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { generateToken, hmacMachineId, hmacToken, normalizeRedeemCode } from "../crypto.js";
import { runMigrations } from "../db/migrate.js";
import { closePool, getPool } from "../db/pool.js";
import {
  adminCreateUser,
  adminGenerateRedeemCodes,
  adminListGroups,
} from "../sub2api/adminClient.js";
import { wbFulfillDeferredOrder, wbGetDeferredOrder } from "../sub2api/serviceClient.js";
import { auditEvent } from "../domain/devices.js";

type Args = Map<string, string>;

function parseArgs(argv: string[]): { command: string; args: Args } {
  const [command = "", ...rest] = argv;
  const args: Args = new Map();
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]!;
    if (part.startsWith("--")) {
      const key = part.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        args.set(key, next);
        i += 1;
      } else {
        args.set(key, "true");
      }
    }
  }
  return { command, args };
}

function required(args: Args, key: string): string {
  const value = args.get(key);
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

async function cmdDoctor(): Promise<void> {
  const config = loadConfig();
  console.log("配置检查通过");
  console.log(`Sub2API: ${config.SUB2API_BASE_URL}`);
  console.log(`网关: ${config.GATEWAY_URL}`);
  const groups = await adminListGroups();
  console.log(`Admin Key 有效，分组数: ${groups.length}`);
  for (const group of groups) {
    console.log(`  [${group.id}] ${group.name} (${group.status})`);
  }
  if (!config.ESCROW_USER_ID) {
    console.warn("警告: 未配置 ESCROW_USER_ID，购买功能不可用（先运行 escrow:init）");
  }
  const applied = await runMigrations();
  console.log(applied.length ? `迁移已应用: ${applied.join(", ")}` : "数据库结构最新");
}

async function cmdEscrowInit(): Promise<void> {
  const config = loadConfig();
  const email = `escrow-${randomUUID().slice(0, 8)}@${config.HIDDEN_USER_EMAIL_DOMAIN}`;
  const password = generateToken(24);
  const user = await adminCreateUser(email, password);
  console.log("托管用户已创建。请把以下值写入部署环境（Docker secret / 环境变量）：");
  console.log(`ESCROW_USER_ID=${user.id}`);
  console.log("注意：托管用户凭据无需保存，履约由服务间接口完成，不需要该用户登录。");
}

async function cmdPackagesAdd(args: Args): Promise<void> {
  const name = required(args, "name");
  const price = Number(required(args, "price"));
  const points = args.get("points") ? Number(required(args, "points")) : price;
  const group = Number(required(args, "group"));
  // Sub2API 收款额度=入账额度，故强制 1 积分=1 元（fee=0），避免到账与承诺不一致。
  if (points !== price) {
    throw new Error(
      `当前计费模型要求积分数等于价格（1 积分=1 元）：price=${price} 与 points=${points} 不一致。` +
        "如需折扣，请调整 Sub2API 的 balance_recharge_multiplier 后再扩展。",
    );
  }
  const groups = await adminListGroups();
  const matched = groups.find((g) => Number(g.id) === group);
  if (!matched) throw new Error(`Sub2API 中不存在分组 ${group}`);
  if (matched.status !== "active") throw new Error(`分组 ${group} 状态为 ${matched.status}`);
  const result = await getPool().query(
    `INSERT INTO packages (name, description, price_cny, points, target_group_id, target_group_name, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      name,
      args.get("desc") ?? "",
      price,
      points,
      group,
      args.get("group-name") ?? matched.name,
      Number(args.get("sort") ?? 0),
    ],
  );
  console.log(`套餐已创建 id=${result.rows[0].id}`);
}

async function cmdPackagesList(): Promise<void> {
  const result = await getPool().query(
    "SELECT id, name, price_cny, points, target_group_id, target_group_name, enabled, sort_order FROM packages ORDER BY sort_order, id",
  );
  console.table(result.rows);
}

async function cmdPackagesSetEnabled(args: Args): Promise<void> {
  const id = Number(required(args, "id"));
  const enabled = required(args, "enabled") === "true";
  await getPool().query("UPDATE packages SET enabled = $1, updated_at = now() WHERE id = $2", [
    enabled,
    id,
  ]);
  console.log(`套餐 ${id} enabled=${enabled}`);
}

interface CatalogFileEntry {
  id: string;
  name: string;
  vendor?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  temperature?: number;
  supportsToolCall?: boolean;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
  onlyReasoning?: boolean;
  useCustomProtocol?: boolean;
  reasoning?: Record<string, unknown>;
  sortOrder?: number;
  enabled?: boolean;
}

const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

function validateCatalogEntry(entry: CatalogFileEntry): void {
  if (!entry.id || !entry.name) throw new Error(`目录条目缺少 id/name: ${JSON.stringify(entry)}`);
  const reasoning = entry.reasoning as
    | { defaultEffort?: string; supportedEfforts?: string[]; summary?: string }
    | undefined;
  if (reasoning?.defaultEffort && !REASONING_EFFORTS.has(reasoning.defaultEffort)) {
    throw new Error(`模型 ${entry.id} defaultEffort 非法: ${reasoning.defaultEffort}`);
  }
  for (const effort of reasoning?.supportedEfforts ?? []) {
    if (!REASONING_EFFORTS.has(effort)) {
      throw new Error(`模型 ${entry.id} supportedEfforts 含非法值: ${effort}`);
    }
  }
  if (reasoning?.summary && !["auto", "always", "never"].includes(reasoning.summary)) {
    throw new Error(`模型 ${entry.id} reasoning.summary 非法: ${reasoning.summary}`);
  }
}

async function cmdCatalogImport(args: Args): Promise<void> {
  const file = required(args, "file");
  const entries = JSON.parse(await readFile(file, "utf8")) as CatalogFileEntry[];
  if (!Array.isArray(entries)) throw new Error("目录文件必须是数组");
  for (const entry of entries) validateCatalogEntry(entry);
  const pool = getPool();
  for (const entry of entries) {
    await pool.query(
      `INSERT INTO model_profiles
         (model_id, display_name, vendor, max_input_tokens, max_output_tokens, temperature,
          supports_tool_call, supports_images, supports_reasoning, only_reasoning,
          use_custom_protocol, reasoning, enabled, sort_order, catalog_version, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,now())
       ON CONFLICT (model_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         vendor = EXCLUDED.vendor,
         max_input_tokens = EXCLUDED.max_input_tokens,
         max_output_tokens = EXCLUDED.max_output_tokens,
         temperature = EXCLUDED.temperature,
         supports_tool_call = EXCLUDED.supports_tool_call,
         supports_images = EXCLUDED.supports_images,
         supports_reasoning = EXCLUDED.supports_reasoning,
         only_reasoning = EXCLUDED.only_reasoning,
         use_custom_protocol = EXCLUDED.use_custom_protocol,
         reasoning = EXCLUDED.reasoning,
         enabled = EXCLUDED.enabled,
         sort_order = EXCLUDED.sort_order,
         catalog_version = model_profiles.catalog_version + 1,
         updated_at = now()`,
      [
        entry.id,
        entry.name,
        entry.vendor ?? "Custom",
        entry.maxInputTokens ?? null,
        entry.maxOutputTokens ?? null,
        entry.temperature ?? null,
        entry.supportsToolCall ?? false,
        entry.supportsImages ?? false,
        entry.supportsReasoning ?? false,
        entry.onlyReasoning ?? false,
        entry.useCustomProtocol ?? false,
        entry.reasoning ? JSON.stringify(entry.reasoning) : null,
        entry.enabled ?? true,
        entry.sortOrder ?? 0,
      ],
    );
  }
  console.log(`已导入/更新 ${entries.length} 个模型能力条目`);
}

async function cmdCatalogList(): Promise<void> {
  const result = await getPool().query(
    "SELECT model_id, display_name, supports_tool_call, supports_reasoning, enabled, catalog_version FROM model_profiles ORDER BY sort_order, model_id",
  );
  console.table(result.rows);
}

async function cmdCodesGenerate(args: Args): Promise<void> {
  const config = loadConfig();
  const points = Number(required(args, "points"));
  const count = Number(args.get("count") ?? 1);
  if (!(count >= 1 && count <= 100)) throw new Error("--count 取值 1-100");
  const packageId = args.get("package") ? Number(args.get("package")) : null;
  let groupId = args.get("group") ? Number(args.get("group")) : null;
  const label = args.get("label") ?? "";
  const expiresDays = args.get("expires-days") ? Number(args.get("expires-days")) : undefined;

  if (packageId) {
    const pkg = await getPool().query("SELECT * FROM packages WHERE id = $1", [packageId]);
    if (!pkg.rows[0]) throw new Error(`套餐 ${packageId} 不存在`);
    // PostgreSQL BIGINT 经 pg 返回字符串，跨 Sub2API 比较前统一转数字。
    groupId = groupId ?? Number(pkg.rows[0].target_group_id);
  }
  if (groupId) {
    const groups = await adminListGroups();
    if (!groups.some((g) => Number(g.id) === Number(groupId) && g.status === "active")) {
      throw new Error(`Sub2API 分组 ${groupId} 不存在或未激活`);
    }
  }

  // 员工输入的码就是 Sub2API 生成的 32 位 hex 原码；业务库只存 HMAC + 套餐/分组映射。
  const codes = await adminGenerateRedeemCodes(count, points, expiresDays);
  const pool = getPool();
  const printed: string[] = [];
  for (const code of codes) {
    await pool.query(
      `INSERT INTO code_mappings (code_hmac, sub2api_code_id, package_id, points, target_group_id, batch_label)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [hmacToken(config.DEVICE_HMAC_SECRET, normalizeRedeemCode(code.code)), code.id, packageId, points, groupId, label],
    );
    printed.push(code.code);
  }
  await auditEvent("codes.generated", null, { count, points, packageId, groupId, label }, "cli");
  console.log("以下兑换码仅此一次输出，请立即安全分发：");
  for (const code of printed) console.log(code);
}

async function cmdCodesVoid(args: Args): Promise<void> {
  const config = loadConfig();
  const code = normalizeRedeemCode(required(args, "code"));
  const result = await getPool().query(
    "UPDATE code_mappings SET status = 'void' WHERE code_hmac = $1 AND status = 'issued'",
    [hmacToken(config.DEVICE_HMAC_SECRET, code)],
  );
  console.log(result.rowCount ? "已作废（注意：Sub2API 侧需在管理台同步作废）" : "未找到可作废的兑换码");
}

async function cmdDevicesList(args: Args): Promise<void> {
  const limit = Number(args.get("limit") ?? 50);
  const result = await getPool().query(
    `SELECT id, device_uuid, status, sub2api_user_id, current_group_id, current_package_id, created_at, last_seen_at
     FROM devices ORDER BY last_seen_at DESC LIMIT $1`,
    [limit],
  );
  console.table(result.rows);
}

async function cmdDevicesFind(args: Args): Promise<void> {
  const uuid = required(args, "uuid");
  const result = await getPool().query("SELECT * FROM devices WHERE device_uuid = $1", [uuid]);
  const device = result.rows[0];
  if (!device) throw new Error("设备不存在");
  // 不输出任何 sealed_* 字段
  const { sealed_user_email, sealed_user_password, sealed_api_key, ...safe } = device;
  console.log(JSON.stringify(safe, null, 2));
}

async function cmdDevicesDisable(args: Args): Promise<void> {
  const uuid = required(args, "uuid");
  const result = await getPool().query(
    "UPDATE devices SET status = 'disabled' WHERE device_uuid = $1 RETURNING id",
    [uuid],
  );
  if (!result.rows[0]) throw new Error("设备不存在");
  await getPool().query(
    "UPDATE device_credentials SET status = 'revoked', revoked_at = now() WHERE device_id = $1",
    [result.rows[0].id],
  );
  await auditEvent("device.disabled", result.rows[0].id, {}, "cli");
  console.log("设备已停用，令牌已全部吊销");
}

async function cmdDevicesMigrate(args: Args): Promise<void> {
  const config = loadConfig();
  const fromUuid = required(args, "from");
  const machineId = required(args, "machine-id");
  const newHmac = hmacMachineId(config.DEVICE_HMAC_SECRET, machineId);
  const pool = getPool();
  const fromResult = await pool.query("SELECT * FROM devices WHERE device_uuid = $1", [fromUuid]);
  const from = fromResult.rows[0];
  if (!from) throw new Error("源设备不存在");
  const conflict = await pool.query("SELECT id FROM devices WHERE machine_hmac = $1", [newHmac]);
  if (conflict.rows[0]) throw new Error("目标机器已注册设备，请先处理该设备");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE devices SET machine_hmac = $1 WHERE id = $2", [newHmac, from.id]);
    await client.query(
      "UPDATE device_credentials SET status = 'revoked', revoked_at = now() WHERE device_id = $1 AND status = 'active'",
      [from.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await auditEvent("device.migrated", from.id, {}, "cli");
  console.log("迁移完成：员工在新机器上打开应用即可自动恢复（将重新签发设备令牌）");
}

async function cmdOrdersRepair(args: Args): Promise<void> {
  const outTradeNo = required(args, "out-trade-no");
  const pool = getPool();
  const linkResult = await pool.query(
    "SELECT * FROM purchase_links WHERE out_trade_no = $1",
    [outTradeNo],
  );
  const link = linkResult.rows[0];
  if (!link) throw new Error("本地订单不存在");
  const deviceResult = await pool.query("SELECT * FROM devices WHERE id = $1", [link.device_id]);
  const device = deviceResult.rows[0];
  if (!device?.sub2api_user_id) {
    throw new Error("设备尚无隐藏用户，请让员工在应用内点击确认兑换（会自动建号）");
  }
  const upstream = await wbGetDeferredOrder(outTradeNo);
  console.log(`上游状态: ${upstream.status}`);
  if (upstream.status === "COMPLETED") {
    await pool.query(
      "UPDATE purchase_links SET status = 'redeemed', redeemed_at = now(), updated_at = now() WHERE id = $1",
      [link.id],
    );
    console.log("上游已完成，本地状态已同步为 redeemed");
    return;
  }
  const fulfilled = await wbFulfillDeferredOrder(outTradeNo, device.sub2api_user_id, device.machine_hmac);
  console.log(`履约结果: ${fulfilled.status}`);
  if (fulfilled.status === "COMPLETED") {
    await pool.query(
      "UPDATE purchase_links SET status = 'redeemed', redeemed_at = now(), updated_at = now() WHERE id = $1",
      [link.id],
    );
    await auditEvent("purchase.repaired", device.id, { outTradeNo }, "cli");
    console.log("订单已修复入账（分组切换请让员工在应用内重新应用配置）");
  }
}

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "doctor":
      await cmdDoctor();
      break;
    case "escrow:init":
      await cmdEscrowInit();
      break;
    case "packages:add":
      await cmdPackagesAdd(args);
      break;
    case "packages:list":
      await cmdPackagesList();
      break;
    case "packages:set-enabled":
      await cmdPackagesSetEnabled(args);
      break;
    case "catalog:import":
      await cmdCatalogImport(args);
      break;
    case "catalog:list":
      await cmdCatalogList();
      break;
    case "codes:generate":
      await cmdCodesGenerate(args);
      break;
    case "codes:void":
      await cmdCodesVoid(args);
      break;
    case "devices:list":
      await cmdDevicesList(args);
      break;
    case "devices:find":
      await cmdDevicesFind(args);
      break;
    case "devices:disable":
      await cmdDevicesDisable(args);
      break;
    case "devices:migrate":
      await cmdDevicesMigrate(args);
      break;
    case "orders:repair":
      await cmdOrdersRepair(args);
      break;
    default:
      console.error(`未知命令: ${command || "(空)"}。查看文件头注释了解全部命令。`);
      process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
