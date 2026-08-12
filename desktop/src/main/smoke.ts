// 真机冒烟测试：用真实的桌面 main 进程模块，对着在线 companion 跑通
// 注册 → 兑换 → 拉模型 → 写配置 → 备份/恢复 → 连通测试，验证整条桌面栈。
//
// 由 main/index.ts 在 WB_SMOKE=1 时调用。结果写入 WB_SMOKE_OUT 指定的 JSON。
// 通过 WB_MODELS_PATH 指向临时文件，绝不触碰员工真实 models.json。

import { readFileSync, writeFileSync } from "node:fs";
import {
  assembleState,
  ensureRegistered,
  redeemCore,
  fetchModelsCore,
  applyModelsCore,
  testModelCore,
} from "./ipc";
import { listBackups, restoreBackup, workbuddyConfigPath } from "./modelsFile";
import { readMachineId } from "./machineId";

interface SmokeResult {
  ok: boolean;
  steps: Array<{ name: string; ok: boolean; detail?: string }>;
}

export async function runSmoke(): Promise<SmokeResult> {
  const steps: SmokeResult["steps"] = [];
  const record = (name: string, ok: boolean, detail?: string) => {
    steps.push(detail === undefined ? { name, ok } : { name, ok, detail });
  };

  try {
    // 1. 机器码（真实读取系统标识）
    const machineId = await readMachineId();
    record("readMachineId", machineId.length > 0, machineId.slice(0, 12) + "...");

    // 2. 设备注册（真实 HTTP + safeStorage 落盘设备令牌）
    await ensureRegistered();
    const state1 = await assembleState();
    record("register + state", state1.deviceUuid !== null && state1.companionReachable, JSON.stringify({ uuid: state1.deviceUuid, reachable: state1.companionReachable }));

    // 3. 兑换公司码（真实 companion 调用）
    const code = process.env.WB_SMOKE_CODE ?? "";
    if (code) {
      const redeem = await redeemCore(code);
      record("redeem company code", Number(redeem.points) === 100, JSON.stringify(redeem));
    } else {
      record("redeem company code", false, "no WB_SMOKE_CODE provided");
    }

    const state2 = await assembleState();
    record("activated after redeem", state2.activated === true, JSON.stringify({ activated: state2.activated, points: state2.points }));

    // 4. 拉取模型（真实网关 /v1/models + 目录交集）
    const fetched = await fetchModelsCore();
    record("fetch models (>=6 visible)", fetched.models.length >= 6, `visible=${fetched.models.length} gatewayTotal=${fetched.gatewayTotal}`);

    // 5. 写配置（真实 schema 校验 + 加密备份 + 原子替换到 WB_MODELS_PATH）
    const selected = fetched.models.map((m) => m.modelId);
    const applied = await applyModelsCore(selected);
    const written = JSON.parse(readFileSync(workbuddyConfigPath(), "utf8"));
    const allValid = Array.isArray(written) && written.length === selected.length && written.every((e: { id?: string; url?: string; apiKey?: string }) => e.id && String(e.url).endsWith("/v1") && e.apiKey);
    record("apply models.json (atomic write)", allValid, `written=${written.length} configPath=${applied.configPath}`);

    // 6. 二次写入触发加密备份轮转
    const applied2 = await applyModelsCore(selected.slice(0, 3));
    record("second apply creates backup", Boolean(applied2.backupId), `backupId=${applied2.backupId}`);

    const backups = listBackups();
    record("backups listed", backups.length >= 1, `count=${backups.length}`);

    // 7. 恢复最近备份（含 6 个模型的那份），校验往返
    if (backups.length >= 1) {
      const target = backups.find((b) => b.modelCount === selected.length) ?? backups[0]!;
      restoreBackup(target.id);
      const restored = JSON.parse(readFileSync(workbuddyConfigPath(), "utf8"));
      record("restore backup round-trip", Array.isArray(restored) && restored.length === target.modelCount, `restored=${restored.length} expected=${target.modelCount}`);
    }

    // 8. 连通测试（真实网关对话）
    const test = await testModelCore(selected[0]!);
    record("connectivity test", test.ok === true, JSON.stringify(test));
  } catch (error) {
    record("exception", false, (error as Error).message);
  }

  const ok = steps.every((s) => s.ok);
  const out = process.env.WB_SMOKE_OUT;
  if (out) writeFileSync(out, JSON.stringify({ ok, steps }, null, 2), "utf8");
  for (const s of steps) console.log(`[smoke] ${s.ok ? "PASS" : "FAIL"} ${s.name}${s.detail ? " :: " + s.detail : ""}`);
  console.log(`[smoke] overall: ${ok ? "PASS" : "FAIL"}`);
  return { ok, steps };
}
