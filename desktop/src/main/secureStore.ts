import { app, safeStorage } from "electron";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ThemeMode } from "@shared/types";

/**
 * 本地小型存储：
 * - 敏感值（设备令牌）经 safeStorage（DPAPI / Keychain）加密后落盘
 * - 普通设置（主题）明文 JSON
 */

interface StoreShape {
  theme?: ThemeMode;
  deviceUuid?: string;
  /** base64(DPAPI 加密后的设备令牌) */
  sealedDeviceToken?: string;
}

let cache: StoreShape | null = null;

function storePath(): string {
  return join(app.getPath("userData"), "store.json");
}

function load(): StoreShape {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(storePath(), "utf8")) as StoreShape;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(): void {
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(storePath(), JSON.stringify(load(), null, 2), "utf8");
}

export function getTheme(): ThemeMode {
  return load().theme ?? "system";
}

export function setTheme(mode: ThemeMode): void {
  load().theme = mode;
  persist();
}

export function getDeviceUuid(): string | null {
  return load().deviceUuid ?? null;
}

export function saveDeviceIdentity(deviceUuid: string, deviceToken: string): void {
  const store = load();
  store.deviceUuid = deviceUuid;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统安全存储不可用，无法保存设备凭证");
  }
  store.sealedDeviceToken = safeStorage.encryptString(deviceToken).toString("base64");
  persist();
}

export function getDeviceToken(): string | null {
  const sealed = load().sealedDeviceToken;
  if (!sealed) return null;
  try {
    return safeStorage.decryptString(Buffer.from(sealed, "base64"));
  } catch {
    return null;
  }
}

export function backupsDir(): string {
  const dir = join(app.getPath("userData"), "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
