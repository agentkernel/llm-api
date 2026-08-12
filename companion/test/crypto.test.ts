import { describe, expect, it } from "vitest";
import {
  constantTimeEqualHex,
  hmacMachineId,
  hmacToken,
  normalizeRedeemCode,
  openSecret,
  sealSecret,
} from "../src/crypto.js";

const masterKey = "a".repeat(64);

describe("crypto", () => {
  it("machine hmac is stable and case-insensitive on input", () => {
    const a = hmacMachineId("salt", "ABC-123-DEF");
    const b = hmacMachineId("salt", "  abc-123-def  ");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacMachineId("other-salt", "ABC-123-DEF")).not.toBe(a);
  });

  it("token hmac differs from raw and is deterministic", () => {
    const token = "device-token-value";
    expect(hmacToken("s", token)).toBe(hmacToken("s", token));
    expect(hmacToken("s", token)).not.toContain(token);
  });

  it("seal/open roundtrip and tamper detection", () => {
    const sealed = sealSecret(masterKey, "sk-super-secret");
    expect(sealed).not.toContain("sk-super-secret");
    expect(openSecret(masterKey, sealed)).toBe("sk-super-secret");
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("a") ? "bb" : "aa");
    expect(() => openSecret(masterKey, tampered)).toThrow();
  });

  it("normalizeRedeemCode trims and lowercases", () => {
    expect(normalizeRedeemCode("  ABCDEF0123  ")).toBe("abcdef0123");
  });

  it("constantTimeEqualHex compares safely", () => {
    expect(constantTimeEqualHex("aabb", "aabb")).toBe(true);
    expect(constantTimeEqualHex("aabb", "aabc")).toBe(false);
    expect(constantTimeEqualHex("", "")).toBe(false);
  });
});
