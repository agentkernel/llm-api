import { safeStorage } from "electron";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BackupEntry } from "@shared/types";
import { backupsDir } from "./secureStore";

/** WorkBuddy models.json 条目 schema（与已验证的 WorkBuddy 源码字段一致）。 */
export interface WorkbuddyModelEntry {
  id: string;
  name: string;
  vendor: string;
  url: string;
  apiKey: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  temperature?: number;
  supportsToolCall?: boolean;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
  onlyReasoning?: boolean;
  useCustomProtocol?: boolean;
  reasoning?: {
    effort?: string;
    defaultEffort?: string;
    supportedEfforts?: string[];
    summary?: "auto" | "always" | "never";
    canDisableThinking?: boolean;
  };
}

const EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);
const SUMMARIES = new Set(["auto", "always", "never"]);

export function workbuddyConfigPath(): string {
  return join(homedir(), ".workbuddy", "models.json");
}

export class ModelsFileError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "SCHEMA_INVALID"
      | "EXTERNAL_MODIFIED"
      | "BACKUP_FAILED"
      | "WRITE_FAILED"
      | "RESTORE_FAILED"
      | "SECURE_STORAGE_UNAVAILABLE",
  ) {
    super(message);
    this.name = "ModelsFileError";
  }
}

/** 严格校验将要写入的条目数组。任何非法字段都拒绝写入。 */
export function validateEntries(entries: WorkbuddyModelEntry[]): void {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ModelsFileError("生成的配置为空", "SCHEMA_INVALID");
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || typeof entry.id !== "string") {
      throw new ModelsFileError("条目缺少 id", "SCHEMA_INVALID");
    }
    if (seen.has(entry.id)) {
      throw new ModelsFileError(`重复的模型 id: ${entry.id}`, "SCHEMA_INVALID");
    }
    seen.add(entry.id);
    if (!entry.name || !entry.vendor) {
      throw new ModelsFileError(`模型 ${entry.id} 缺少 name/vendor`, "SCHEMA_INVALID");
    }
    if (!entry.url.endsWith("/v1")) {
      throw new ModelsFileError(`模型 ${entry.id} 的 url 必须以 /v1 结尾`, "SCHEMA_INVALID");
    }
    if (!entry.apiKey) {
      throw new ModelsFileError(`模型 ${entry.id} 缺少 apiKey`, "SCHEMA_INVALID");
    }
    for (const field of ["maxInputTokens", "maxOutputTokens", "temperature"] as const) {
      const value = entry[field];
      if (value !== undefined && (typeof value !== "number" || Number.isNaN(value))) {
        throw new ModelsFileError(`模型 ${entry.id} 的 ${field} 必须是数字`, "SCHEMA_INVALID");
      }
    }
    const reasoning = entry.reasoning;
    if (reasoning) {
      for (const key of ["effort", "defaultEffort"] as const) {
        const value = reasoning[key];
        if (value !== undefined && !EFFORTS.has(value)) {
          throw new ModelsFileError(`模型 ${entry.id} 的 ${key} 非法: ${value}`, "SCHEMA_INVALID");
        }
      }
      for (const effort of reasoning.supportedEfforts ?? []) {
        if (!EFFORTS.has(effort)) {
          throw new ModelsFileError(
            `模型 ${entry.id} supportedEfforts 含非法值: ${effort}`,
            "SCHEMA_INVALID",
          );
        }
      }
      if (reasoning.summary !== undefined && !SUMMARIES.has(reasoning.summary)) {
        throw new ModelsFileError(`模型 ${entry.id} summary 非法`, "SCHEMA_INVALID");
      }
    }
  }
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface ConfigSnapshot {
  exists: boolean;
  hash: string | null;
  mtimeMs: number | null;
}

export function snapshotConfig(path = workbuddyConfigPath()): ConfigSnapshot {
  if (!existsSync(path)) return { exists: false, hash: null, mtimeMs: null };
  const content = readFileSync(path);
  return { exists: true, hash: sha256(content), mtimeMs: statSync(path).mtimeMs };
}

interface BackupMeta {
  id: string;
  createdAt: string;
  sha256: string;
  sizeBytes: number;
  modelCount: number | null;
}

const BACKUP_KEEP = 5;

function metaPath(): string {
  return join(backupsDir(), "meta.json");
}

function readMeta(): BackupMeta[] {
  try {
    return JSON.parse(readFileSync(metaPath(), "utf8")) as BackupMeta[];
  } catch {
    return [];
  }
}

function writeMeta(meta: BackupMeta[]): void {
  writeFileSync(metaPath(), JSON.stringify(meta, null, 2), "utf8");
}

/** 加密备份当前 models.json；返回备份 id（文件不存在时返回 null）。 */
export function backupCurrentConfig(reason: string, path = workbuddyConfigPath()): string | null {
  if (!existsSync(path)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new ModelsFileError("系统安全存储不可用，无法加密备份", "SECURE_STORAGE_UNAVAILABLE");
  }
  const content = readFileSync(path);
  let modelCount: number | null = null;
  try {
    const parsed = JSON.parse(content.toString("utf8"));
    modelCount = Array.isArray(parsed) ? parsed.length : null;
  } catch {
    modelCount = null;
  }
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${reason}`;
  const encrypted = safeStorage.encryptString(content.toString("utf8"));
  try {
    writeFileSync(join(backupsDir(), `${id}.bak`), encrypted);
  } catch (error) {
    throw new ModelsFileError(`备份写入失败: ${(error as Error).message}`, "BACKUP_FAILED");
  }
  const meta = readMeta();
  meta.unshift({
    id,
    createdAt: new Date().toISOString(),
    sha256: sha256(content),
    sizeBytes: content.length,
    modelCount,
  });
  // 轮转：只保留最近 5 份
  for (const stale of meta.slice(BACKUP_KEEP)) {
    try {
      unlinkSync(join(backupsDir(), `${stale.id}.bak`));
    } catch {
      // 忽略缺失文件
    }
  }
  writeMeta(meta.slice(0, BACKUP_KEEP));
  return id;
}

export function listBackups(): BackupEntry[] {
  const existing = new Set(readdirSync(backupsDir()));
  return readMeta().filter((entry) => existing.has(`${entry.id}.bak`));
}

/**
 * 原子替换 models.json：
 * 1. 校验条目
 * 2. 外部修改检测（与 fetch 时快照对比）
 * 3. 加密备份原文件
 * 4. 同目录临时文件 + rename 原子替换；失败不破坏原文件
 */
export function applyConfig(
  entries: WorkbuddyModelEntry[],
  expectedSnapshot: ConfigSnapshot | null,
  path = workbuddyConfigPath(),
): { backupId: string | null; configPath: string } {
  validateEntries(entries);

  if (expectedSnapshot) {
    const current = snapshotConfig(path);
    if (current.exists !== expectedSnapshot.exists || current.hash !== expectedSnapshot.hash) {
      throw new ModelsFileError(
        "models.json 在此期间被其他程序修改，请刷新后重试",
        "EXTERNAL_MODIFIED",
      );
    }
  }

  const backupId = backupCurrentConfig("apply", path);

  const serialized = `${JSON.stringify(entries, null, 2)}\n`;
  // 写入前再做一次完整 JSON round-trip 校验
  JSON.parse(serialized);

  const tempPath = `${path}.wb-tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tempPath, serialized, "utf8");
    renameSync(tempPath, path);
  } catch (error) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // 保留原文件优先
    }
    throw new ModelsFileError(`写入失败: ${(error as Error).message}`, "WRITE_FAILED");
  }
  return { backupId, configPath: path };
}

/** 恢复指定备份（恢复前同样备份当前文件）。 */
export function restoreBackup(id: string, path = workbuddyConfigPath()): void {
  const file = join(backupsDir(), `${id}.bak`);
  if (!existsSync(file)) {
    throw new ModelsFileError("备份不存在", "RESTORE_FAILED");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new ModelsFileError("系统安全存储不可用", "SECURE_STORAGE_UNAVAILABLE");
  }
  let plaintext: string;
  try {
    plaintext = safeStorage.decryptString(readFileSync(file));
  } catch (error) {
    throw new ModelsFileError(`备份解密失败: ${(error as Error).message}`, "RESTORE_FAILED");
  }
  const parsed = JSON.parse(plaintext);
  if (!Array.isArray(parsed)) {
    throw new ModelsFileError("备份内容不是合法的模型数组", "RESTORE_FAILED");
  }

  backupCurrentConfig("pre-restore", path);

  const tempPath = `${path}.wb-tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tempPath, plaintext, "utf8");
    renameSync(tempPath, path);
  } catch (error) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // 保留原文件
    }
    throw new ModelsFileError(`恢复写入失败: ${(error as Error).message}`, "RESTORE_FAILED");
  }
}
