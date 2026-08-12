// 端到端编排公共库。
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const SUB2API = process.env.E2E_SUB2API ?? "http://127.0.0.1:18080";
export const COMPANION = process.env.E2E_COMPANION ?? "http://127.0.0.1:8720";
export const FAKE_OPENAI = process.env.E2E_FAKE_OPENAI ?? "http://127.0.0.1:4790";
export const FAKE_EASYPAY = process.env.E2E_FAKE_EASYPAY ?? "http://127.0.0.1:4780";

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@wb.local";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "wb-admin-pass-2026";
export const EASYPAY_PID = "1000";
export const EASYPAY_PKEY = "wb-easypay-secret-local-2026";

export const STATE_FILE =
  process.env.E2E_STATE ?? "D:/workbuddy-model-assistant/.local/e2e-state.json";

export function loadState() {
  if (existsSync(STATE_FILE)) {
    // PowerShell 写入可能带 UTF-8 BOM，解析前剥离。
    const text = readFileSync(STATE_FILE, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  }
  return {};
}

export function saveState(patch) {
  const current = loadState();
  const next = { ...current, ...patch };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function req(base, path, { method = "GET", headers = {}, body, raw = false } = {}) {
  const res = await fetch(new URL(path, base), {
    method,
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new HttpError(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`, res.status, parsed);
  }
  if (raw) return parsed;
  // 面板包装 {code,message,data}
  if (parsed && typeof parsed === "object" && "code" in parsed && "data" in parsed) {
    if (parsed.code !== 0) {
      throw new HttpError(`${method} ${path} panel code ${parsed.code}: ${parsed.message}`, res.status, parsed);
    }
    return parsed.data;
  }
  return parsed;
}

let passed = 0;
let failed = 0;
const failures = [];

export function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    failures.push(`${name} ${detail}`);
    console.log(`  \u2717 ${name} ${detail}`);
  }
}

export function summary(label) {
  console.log(`\n[${label}] passed=${passed} failed=${failed}`);
  if (failed > 0) {
    console.log("FAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
  return failed === 0;
}

export function log(msg) {
  console.log(`[e2e] ${msg}`);
}

export async function waitFor(fn, { tries = 30, intervalMs = 1000, label = "condition" } = {}) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out: ${label}`);
}
