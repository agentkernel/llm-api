import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tempRoot = mkdtempSync(join(tmpdir(), "wb-models-test-"));
const userDataDir = join(tempRoot, "userData");

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataDir,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("bad ciphertext");
      return text.slice(4);
    },
  },
}));

import {
  applyConfig,
  backupCurrentConfig,
  listBackups,
  ModelsFileError,
  restoreBackup,
  snapshotConfig,
  validateEntries,
  type WorkbuddyModelEntry,
} from "../src/main/modelsFile";

function entry(id: string): WorkbuddyModelEntry {
  return {
    id,
    name: id.toUpperCase(),
    vendor: "Custom",
    url: "https://api.example.com/v1",
    apiKey: "sk-test",
    maxInputTokens: 262144,
    supportsToolCall: true,
    supportsReasoning: true,
    reasoning: { defaultEffort: "medium", supportedEfforts: ["low", "medium", "high"] },
  };
}

let configPath: string;
let counter = 0;

beforeEach(() => {
  counter += 1;
  configPath = join(tempRoot, `models-${counter}.json`);
});

describe("validateEntries", () => {
  it("rejects empty arrays", () => {
    expect(() => validateEntries([])).toThrow(ModelsFileError);
  });

  it("rejects duplicate ids, bad urls and bad efforts", () => {
    expect(() => validateEntries([entry("a"), entry("a")])).toThrow(/重复/);
    expect(() => validateEntries([{ ...entry("a"), url: "https://api.example.com" }])).toThrow(
      /\/v1 结尾/,
    );
    expect(() =>
      validateEntries([
        { ...entry("a"), reasoning: { defaultEffort: "ultra" } as never },
      ]),
    ).toThrow(/非法/);
  });

  it("accepts all legal effort values", () => {
    for (const effort of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
      expect(() =>
        validateEntries([{ ...entry("a"), reasoning: { defaultEffort: effort } }]),
      ).not.toThrow();
    }
  });
});

describe("applyConfig", () => {
  it("writes a fresh config when none exists", () => {
    const result = applyConfig([entry("gpt-5.6")], null, configPath);
    expect(result.backupId).toBeNull();
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written).toHaveLength(1);
    expect(written[0].id).toBe("gpt-5.6");
  });

  it("backs up the previous file before replacing", () => {
    writeFileSync(configPath, JSON.stringify([entry("old-model")]), "utf8");
    const result = applyConfig([entry("new-model")], null, configPath);
    expect(result.backupId).not.toBeNull();
    const backups = listBackups();
    expect(backups.some((backup) => backup.id === result.backupId)).toBe(true);
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written[0].id).toBe("new-model");
  });

  it("detects external modification between fetch and apply", () => {
    writeFileSync(configPath, JSON.stringify([entry("v1")]), "utf8");
    const snapshot = snapshotConfig(configPath);
    writeFileSync(configPath, JSON.stringify([entry("v2")]), "utf8");
    expect(() => applyConfig([entry("v3")], snapshot, configPath)).toThrow(/被其他程序修改/);
    // 原文件保持外部修改后的内容不变
    expect(JSON.parse(readFileSync(configPath, "utf8"))[0].id).toBe("v2");
  });

  it("keeps at most 5 backups", () => {
    writeFileSync(configPath, JSON.stringify([entry("seed")]), "utf8");
    for (let i = 0; i < 8; i += 1) {
      applyConfig([entry(`model-${i}`)], null, configPath);
    }
    const backups = listBackups();
    expect(backups.length).toBeLessThanOrEqual(5);
    const files = readdirSync(join(userDataDir, "backups")).filter((f) => f.endsWith(".bak"));
    expect(files.length).toBeLessThanOrEqual(5);
  });
});

describe("restoreBackup", () => {
  it("round-trips the original content", () => {
    const original = [entry("restore-me")];
    writeFileSync(configPath, JSON.stringify(original, null, 2), "utf8");
    const backupId = backupCurrentConfig("apply", configPath);
    expect(backupId).not.toBeNull();

    applyConfig([entry("something-else")], null, configPath);
    restoreBackup(backupId!, configPath);

    const restored = JSON.parse(readFileSync(configPath, "utf8"));
    expect(restored[0].id).toBe("restore-me");
  });

  it("fails cleanly for a missing backup id", () => {
    expect(() => restoreBackup("does-not-exist", configPath)).toThrow(/备份不存在/);
    expect(existsSync(configPath)).toBe(false);
  });
});
