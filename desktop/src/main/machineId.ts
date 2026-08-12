import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * 读取系统稳定机器标识（原始值只在本进程内存中出现，
 * 上送前由服务端做加盐 HMAC，本地不落盘）。
 */
export async function readMachineId(): Promise<string> {
  // 测试覆盖（仅 main 进程读取，不暴露给 renderer；生产不设置）。
  const override = process.env.WB_MACHINE_ID;
  if (override && override.trim()) return override.trim();
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("reg", [
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
      "/v",
      "MachineGuid",
    ]);
    const match = stdout.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
    if (!match?.[1]) throw new Error("cannot read MachineGuid");
    return `win:${match[1]}`;
  }
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
    const match = stdout.match(/"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]+)"/);
    if (!match?.[1]) throw new Error("cannot read IOPlatformUUID");
    return `mac:${match[1]}`;
  }
  throw new Error(`unsupported platform: ${process.platform}`);
}
