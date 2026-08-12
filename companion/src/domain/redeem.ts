import { loadConfig } from "../config.js";
import { hmacToken, normalizeRedeemCode } from "../crypto.js";
import { getPool } from "../db/pool.js";
import { Sub2ApiError } from "../sub2api/http.js";
import { userRedeem } from "../sub2api/userClient.js";
import {
  auditEvent,
  ensureApiKey,
  ensureHiddenUser,
  hiddenUserCredentials,
  type DeviceRow,
} from "./devices.js";

export interface CodeMappingRow {
  id: number;
  code_hmac: string;
  sub2api_code_id: number | null;
  package_id: number | null;
  points: string;
  target_group_id: number | null;
  status: "issued" | "redeemed" | "void";
  redeemed_by_device: number | null;
}

export class RedeemError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CODE_NOT_FOUND"
      | "CODE_ALREADY_REDEEMED"
      | "CODE_VOID"
      | "UPSTREAM_REJECTED",
  ) {
    super(message);
    this.name = "RedeemError";
  }
}

/**
 * 公司码兑换：
 * 1. 本地映射校验（Sub2API 无 dry-run，先在业务库确定归属与套餐）
 * 2. 确保隐藏用户存在
 * 3. Sub2API 实际兑换（已用码通过兑换历史判断是否本用户，支持崩溃重试收敛）
 * 4. 切换分组、确保唯一 Key、更新本地状态
 */
export async function redeemCompanyCode(
  device: DeviceRow,
  rawCode: string,
): Promise<{ points: number; groupId: number | null; packageId: number | null }> {
  const config = loadConfig();
  const code = normalizeRedeemCode(rawCode);
  const codeHmac = hmacToken(config.DEVICE_HMAC_SECRET, code);
  const pool = getPool();

  const mappingResult = await pool.query<CodeMappingRow>(
    "SELECT * FROM code_mappings WHERE code_hmac = $1",
    [codeHmac],
  );
  const mapping = mappingResult.rows[0];
  if (!mapping) throw new RedeemError("兑换码不存在", "CODE_NOT_FOUND");
  if (mapping.status === "void") throw new RedeemError("兑换码已作废", "CODE_VOID");
  if (mapping.status === "redeemed") {
    if (mapping.redeemed_by_device === device.id) {
      // 幂等：同设备重复提交返回成功状态
      return {
        points: Number(mapping.points),
        groupId: mapping.target_group_id === null ? null : Number(mapping.target_group_id),
        packageId: mapping.package_id,
      };
    }
    throw new RedeemError("兑换码已被使用", "CODE_ALREADY_REDEEMED");
  }

  let activeDevice = await ensureHiddenUser(device);
  const creds = hiddenUserCredentials(activeDevice);

  try {
    await userRedeem(creds, code);
  } catch (error) {
    if (error instanceof Sub2ApiError && isAlreadyUsedError(error)) {
      // 可能是上次兑换成功后本地状态未落库（崩溃重试）。
      // mapping 仍是 issued 且无其他设备记录，视为本设备已兑换，继续收敛。
    } else {
      throw new RedeemError(
        error instanceof Error ? error.message : "上游兑换失败",
        "UPSTREAM_REJECTED",
      );
    }
  }

  // pg 将 BIGINT 作为字符串返回，切换 Sub2API 分组前统一转数字。
  const targetGroupId =
    mapping.target_group_id === null ? null : Number(mapping.target_group_id);
  activeDevice = await ensureApiKey(activeDevice, targetGroupId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE code_mappings
       SET status = 'redeemed', redeemed_by_device = $1, redeemed_at = now()
       WHERE id = $2 AND status = 'issued'`,
      [activeDevice.id, mapping.id],
    );
    if (updated.rowCount === 0) {
      throw new RedeemError("兑换码已被使用", "CODE_ALREADY_REDEEMED");
    }
    await client.query(
      "UPDATE devices SET current_package_id = COALESCE($1, current_package_id) WHERE id = $2",
      [mapping.package_id, activeDevice.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await auditEvent("code.redeemed", activeDevice.id, {
    mappingId: mapping.id,
    points: Number(mapping.points),
    groupId: targetGroupId,
  });

  return {
    points: Number(mapping.points),
    groupId: targetGroupId,
    packageId: mapping.package_id,
  };
}

function isAlreadyUsedError(error: Sub2ApiError): boolean {
  const message = error.message.toLowerCase();
  return message.includes("used") || message.includes("已使用") || message.includes("已被使用");
}
