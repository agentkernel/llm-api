import { describe, expect, it } from "vitest";
import { normalizeDeviceRow, type DeviceRow } from "../src/domain/devices.js";

function baseRow(overrides: Partial<DeviceRow>): DeviceRow {
  return {
    id: 1,
    device_uuid: "uuid",
    machine_hmac: "hmac",
    status: "active",
    sub2api_user_id: null,
    sub2api_key_id: null,
    current_group_id: null,
    current_package_id: null,
    sealed_user_email: null,
    sealed_user_password: null,
    sealed_api_key: null,
    ...overrides,
  } as DeviceRow;
}

describe("normalizeDeviceRow", () => {
  it("coerces BIGINT-as-string foreign keys to numbers", () => {
    // pg 把 BIGINT 读成字符串，模拟该行为
    const row = baseRow({
      sub2api_user_id: "42" as unknown as number,
      sub2api_key_id: "7" as unknown as number,
      current_group_id: "2" as unknown as number,
      current_package_id: "1" as unknown as number,
    });
    const normalized = normalizeDeviceRow(row);
    expect(normalized.sub2api_user_id).toBe(42);
    expect(normalized.sub2api_key_id).toBe(7);
    expect(normalized.current_group_id).toBe(2);
    expect(normalized.current_package_id).toBe(1);
    expect(typeof normalized.sub2api_user_id).toBe("number");
  });

  it("leaves nulls and numbers untouched", () => {
    const row = baseRow({ sub2api_user_id: 99, current_group_id: null });
    const normalized = normalizeDeviceRow(row);
    expect(normalized.sub2api_user_id).toBe(99);
    expect(normalized.current_group_id).toBeNull();
  });
});
