import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "../src/repos/token-repo.js";

describe("generateToken", () => {
  it("returns an stk_-prefixed token with a 43-char base64url secret", () => {
    const token = generateToken();

    expect(token.startsWith("stk_")).toBe(true);
    // 32 random bytes → 43 base64url chars, no padding.
    expect(token).toMatch(/^stk_[A-Za-z0-9_-]{43}$/);
    expect(token.length).toBe(47);
  });

  it("never repeats", () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe("hashToken", () => {
  it("is deterministic SHA-256 hex of the plaintext", () => {
    // Hand-calculated independently via `shasum -a 256` on the exact string.
    expect(hashToken("stk_unit-test-token-0123456789abcdef")).toBe(
      "717b86282dee7b1608ad3f059e4d98427ffa5b90d62588c843053a73fd665086",
    );
  });

  it("produces 64 lowercase hex chars", () => {
    expect(hashToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs from the plaintext and is sensitive to it", () => {
    const token = generateToken();
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).not.toBe(hashToken(`${token}x`));
  });
});
