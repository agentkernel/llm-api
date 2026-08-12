import { randomUUID } from "node:crypto";
import type pg from "pg";
import { loadConfig } from "../config.js";
import {
  generateToken,
  hmacMachineId,
  hmacToken,
  openSecret,
  sealSecret,
} from "../crypto.js";
import { getPool } from "../db/pool.js";
import { adminCreateUser } from "../sub2api/adminClient.js";
import {
  userCreateKey,
  userListKeys,
  userUpdateKeyGroup,
  type HiddenUserCredentials,
} from "../sub2api/userClient.js";

export interface DeviceRow {
  id: number;
  device_uuid: string;
  machine_hmac: string;
  status: "active" | "disabled" | "migrated";
  sub2api_user_id: number | null;
  sub2api_key_id: number | null;
  current_group_id: number | null;
  current_package_id: number | null;
  sealed_user_email: string | null;
  sealed_user_password: string | null;
  sealed_api_key: string | null;
}

export class DeviceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "DEVICE_DISABLED"
      | "DEVICE_NOT_FOUND"
      | "NOT_ACTIVATED"
      | "INVALID_TOKEN",
  ) {
    super(message);
    this.name = "DeviceError";
  }
}

/**
 * pg 把 BIGINT 列读成字符串。统一把设备行的数值外键规范化为 number|null，
 * 避免它们以字符串形式流入 Sub2API（期望 int64）或前端。
 */
export function normalizeDeviceRow(row: DeviceRow): DeviceRow {
  if (!row) return row;
  const record = row as unknown as Record<string, unknown>;
  for (const key of [
    "sub2api_user_id",
    "sub2api_key_id",
    "current_group_id",
    "current_package_id",
  ] as const) {
    const value = record[key];
    if (typeof value === "string" && value !== "") {
      record[key] = Number(value);
    }
  }
  return row;
}

export async function auditEvent(
  eventType: string,
  deviceId: number | null,
  detail: Record<string, unknown>,
  actor = "system",
): Promise<void> {
  await getPool().query(
    "INSERT INTO audit_events (event_type, device_id, actor, detail) VALUES ($1, $2, $3, $4)",
    [eventType, deviceId, actor, JSON.stringify(detail)],
  );
}

/** 注册或恢复设备：同一机器码 HMAC 恢复原设备并轮换令牌。 */
export async function registerDevice(
  rawMachineId: string,
): Promise<{ deviceUuid: string; deviceToken: string; activated: boolean; recovered: boolean }> {
  const config = loadConfig();
  const machineHmac = hmacMachineId(config.DEVICE_HMAC_SECRET, rawMachineId);
  const pool = getPool();

  const existing = await pool.query<DeviceRow>(
    "SELECT * FROM devices WHERE machine_hmac = $1",
    [machineHmac],
  );

  let device: DeviceRow;
  let recovered = false;
  if (existing.rows[0]) {
    device = existing.rows[0];
    if (device.status === "disabled") {
      throw new DeviceError("device is disabled by administrator", "DEVICE_DISABLED");
    }
    recovered = true;
  } else {
    const inserted = await pool.query<DeviceRow>(
      "INSERT INTO devices (device_uuid, machine_hmac) VALUES ($1, $2) RETURNING *",
      [randomUUID(), machineHmac],
    );
    device = inserted.rows[0]!;
  }

  // 令牌轮换：撤销旧凭证，签发新凭证（应用重装后旧令牌立即失效）。
  const token = generateToken();
  const tokenHmac = hmacToken(config.DEVICE_HMAC_SECRET, token);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE device_credentials SET status = 'revoked', revoked_at = now() WHERE device_id = $1 AND status = 'active'",
      [device.id],
    );
    await client.query(
      "INSERT INTO device_credentials (device_id, token_hmac) VALUES ($1, $2)",
      [device.id, tokenHmac],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await auditEvent(recovered ? "device.recovered" : "device.registered", device.id, {});
  return {
    deviceUuid: device.device_uuid,
    deviceToken: token,
    activated: device.sub2api_user_id !== null && device.sealed_api_key !== null,
    recovered,
  };
}

/** 设备令牌认证。 */
export async function authenticateDevice(token: string): Promise<DeviceRow> {
  const config = loadConfig();
  const tokenHmac = hmacToken(config.DEVICE_HMAC_SECRET, token);
  const result = await getPool().query<DeviceRow>(
    `SELECT d.* FROM devices d
     JOIN device_credentials c ON c.device_id = d.id
     WHERE c.token_hmac = $1 AND c.status = 'active'`,
    [tokenHmac],
  );
  const device = result.rows[0];
  if (!device) throw new DeviceError("invalid device token", "INVALID_TOKEN");
  if (device.status === "disabled") {
    throw new DeviceError("device is disabled by administrator", "DEVICE_DISABLED");
  }
  void getPool()
    .query("UPDATE devices SET last_seen_at = now() WHERE id = $1", [device.id])
    .catch(() => undefined);
  return normalizeDeviceRow(device);
}

export function hiddenUserCredentials(device: DeviceRow): HiddenUserCredentials {
  const config = loadConfig();
  if (!device.sealed_user_email || !device.sealed_user_password) {
    throw new DeviceError("device has no hidden user yet", "NOT_ACTIVATED");
  }
  return {
    email: openSecret(config.ENVELOPE_MASTER_KEY_HEX, device.sealed_user_email),
    password: openSecret(config.ENVELOPE_MASTER_KEY_HEX, device.sealed_user_password),
  };
}

/** 确保设备存在隐藏 Sub2API 用户；返回最新设备行。 */
export async function ensureHiddenUser(device: DeviceRow): Promise<DeviceRow> {
  if (device.sub2api_user_id && device.sealed_user_email && device.sealed_user_password) {
    return normalizeDeviceRow(device);
  }
  const config = loadConfig();
  const email = `dev-${device.device_uuid}@${config.HIDDEN_USER_EMAIL_DOMAIN}`;
  const password = generateToken(24);
  const user = await adminCreateUser(email, password);
  const result = await getPool().query<DeviceRow>(
    `UPDATE devices
     SET sub2api_user_id = $1, sealed_user_email = $2, sealed_user_password = $3
     WHERE id = $4 RETURNING *`,
    [
      user.id,
      sealSecret(config.ENVELOPE_MASTER_KEY_HEX, email),
      sealSecret(config.ENVELOPE_MASTER_KEY_HEX, password),
      device.id,
    ],
  );
  await auditEvent("device.hidden_user_created", device.id, { sub2apiUserId: user.id });
  return normalizeDeviceRow(result.rows[0]!);
}

/** 确保设备拥有唯一 API Key，并把 key 切换到目标分组。 */
export async function ensureApiKey(
  device: DeviceRow,
  targetGroupId: number | null,
): Promise<DeviceRow> {
  const config = loadConfig();
  const creds = hiddenUserCredentials(device);
  const keys = await userListKeys(creds);
  const active = keys.filter((k) => k.status === "active" || k.status === "enabled");

  let keyId = device.sub2api_key_id;
  let rawKey: string | null = null;

  const existing = keyId ? active.find((k) => k.id === keyId) : active[0];
  if (existing) {
    keyId = existing.id;
    rawKey = existing.key;
    if (targetGroupId && existing.group_id !== targetGroupId) {
      await userUpdateKeyGroup(creds, existing.id, targetGroupId);
    }
  } else {
    const created = await userCreateKey(
      creds,
      `workbuddy-${device.device_uuid.slice(0, 8)}`,
      targetGroupId ?? undefined,
    );
    keyId = created.id;
    rawKey = created.key;
  }

  const result = await getPool().query<DeviceRow>(
    `UPDATE devices
     SET sub2api_key_id = $1, sealed_api_key = $2, current_group_id = COALESCE($3, current_group_id)
     WHERE id = $4 RETURNING *`,
    [keyId, rawKey ? sealSecret(config.ENVELOPE_MASTER_KEY_HEX, rawKey) : device.sealed_api_key, targetGroupId, device.id],
  );
  return normalizeDeviceRow(result.rows[0]!);
}

/** 桌面端 main 进程获取配置材料（原始 key 仅经 TLS 下发一次性使用）。 */
export function configMaterial(device: DeviceRow): { gatewayUrl: string; apiKey: string } {
  const config = loadConfig();
  if (!device.sealed_api_key) {
    throw new DeviceError("device not activated", "NOT_ACTIVATED");
  }
  return {
    gatewayUrl: config.GATEWAY_URL,
    apiKey: openSecret(config.ENVELOPE_MASTER_KEY_HEX, device.sealed_api_key),
  };
}

export async function getDeviceById(id: number): Promise<DeviceRow | null> {
  const result = await getPool().query<DeviceRow>("SELECT * FROM devices WHERE id = $1", [id]);
  return result.rows[0] ? normalizeDeviceRow(result.rows[0]) : null;
}

export type { pg };
