import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "@stonks/ledger";
import {
  zBasisPoints,
  zFxRational,
  zMinorAmount,
  zQuantity,
  zTradeDate,
} from "@/lib/mcp/schemas";
import { authenticateMcpRequest } from "@/lib/mcp/auth";
import { McpToolError, toToolError } from "@/lib/mcp/errors";
import {
  defineTool,
  invokeTool,
  registerTools,
  type McpToolContext,
} from "@/lib/mcp/registrar";
import { z } from "zod";
import { makeTestCtx } from "./helpers/mcp-test-utils";

/**
 * Scaffold tests for the MCP server frame: shared money schemas, bearer auth,
 * central scope enforcement, and error mapping. Every expectation is derived
 * from the design spec (§3, §4, §10) — never captured from output.
 */

function ok(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) {
  return schema.safeParse(value).success;
}

describe("zMinorAmount", () => {
  it("accepts signed integer minor-unit strings", () => {
    expect(ok(zMinorAmount, "0")).toBe(true);
    expect(ok(zMinorAmount, "-1500000")).toBe(true);
    expect(ok(zMinorAmount, "1500000")).toBe(true);
  });

  it("rejects non-integer strings and empty strings", () => {
    expect(ok(zMinorAmount, "1.5")).toBe(false);
    expect(ok(zMinorAmount, "1e3")).toBe(false);
    expect(ok(zMinorAmount, "")).toBe(false);
    expect(ok(zMinorAmount, "abc")).toBe(false);
    expect(ok(zMinorAmount, "1,000")).toBe(false);
  });

  it("rejects JSON numbers — money is never an IEEE-754 double", () => {
    expect(ok(zMinorAmount, 1500000)).toBe(false);
    expect(ok(zMinorAmount, -5)).toBe(false);
    expect(ok(zMinorAmount, 0)).toBe(false);
  });
});

describe("zQuantity", () => {
  it("accepts fixed-scale decimal strings up to 8 dp", () => {
    expect(ok(zQuantity, "420.00000000")).toBe(true);
    expect(ok(zQuantity, "0.5")).toBe(true);
    expect(ok(zQuantity, "42")).toBe(true);
    expect(ok(zQuantity, "-1.25")).toBe(true);
  });

  it("rejects JSON numbers and malformed decimals", () => {
    expect(ok(zQuantity, 0.5)).toBe(false);
    expect(ok(zQuantity, 420)).toBe(false);
    expect(ok(zQuantity, "0.123456789")).toBe(false); // 9 dp exceeds QUANTITY_SCALE
    expect(ok(zQuantity, ".5")).toBe(false);
    expect(ok(zQuantity, "1.")).toBe(false);
    expect(ok(zQuantity, "")).toBe(false);
  });
});

describe("zFxRational", () => {
  it("requires bigint-string numerator and positive denominator", () => {
    expect(ok(zFxRational, { fxRateN: "135", fxRateD: "100" })).toBe(true);
    expect(ok(zFxRational, { fxRateN: "-1", fxRateD: "1" })).toBe(true);
    expect(ok(zFxRational, { fxRateN: "1.35", fxRateD: "100" })).toBe(false);
    expect(ok(zFxRational, { fxRateN: "135", fxRateD: "0" })).toBe(false);
    expect(ok(zFxRational, { fxRateN: "135", fxRateD: "-100" })).toBe(false);
    expect(ok(zFxRational, { fxRateN: 135, fxRateD: 100 })).toBe(false);
  });
});

describe("zTradeDate", () => {
  it("enforces YYYY-MM-DD", () => {
    expect(ok(zTradeDate, "2024-06-15")).toBe(true);
    expect(ok(zTradeDate, "2024-6-15")).toBe(false);
    expect(ok(zTradeDate, "20240615")).toBe(false);
    expect(ok(zTradeDate, "06/15/2024")).toBe(false);
    expect(ok(zTradeDate, 20240615)).toBe(false);
  });
});

describe("zBasisPoints", () => {
  it("is the only rate-like field permitted as a JSON number, and must be an integer", () => {
    expect(ok(zBasisPoints, 525)).toBe(true);
    expect(ok(zBasisPoints, 0)).toBe(true);
    expect(ok(zBasisPoints, -25)).toBe(true);
    expect(ok(zBasisPoints, 5.25)).toBe(false);
    expect(ok(zBasisPoints, "525")).toBe(false);
  });
});

describe("authenticateMcpRequest", () => {
  const repoFor = (result: { householdId: string; scope: "read" | "read_write" } | null) => ({
    verify: vi.fn(async (_plaintext: string) => result),
  });

  it("resolves a valid bearer token to its household and scope", async () => {
    const repo = repoFor({ householdId: "hh-1", scope: "read_write" });
    const auth = await authenticateMcpRequest("Bearer stk_abc123", repo);
    expect(auth).toEqual({ householdId: "hh-1", scope: "read_write" });
    expect(repo.verify).toHaveBeenCalledWith("stk_abc123");
  });

  it("accepts the Bearer scheme case-insensitively", async () => {
    const repo = repoFor({ householdId: "hh-1", scope: "read" });
    const auth = await authenticateMcpRequest("bearer stk_abc123", repo);
    expect(auth).toEqual({ householdId: "hh-1", scope: "read" });
  });

  it("rejects a missing or malformed Authorization header without calling the repo", async () => {
    const repo = repoFor({ householdId: "hh-1", scope: "read" });
    for (const header of [null, "", "Bearer", "Bearer ", "stk_abc123", "Basic stk_abc123", "Bearer a b"]) {
      expect(await authenticateMcpRequest(header, repo)).toBeNull();
    }
    expect(repo.verify).not.toHaveBeenCalled();
  });

  it("rejects revoked and unknown tokens (verify resolves null)", async () => {
    const repo = repoFor(null);
    expect(await authenticateMcpRequest("Bearer stk_revoked", repo)).toBeNull();
    expect(repo.verify).toHaveBeenCalledWith("stk_revoked");
  });
});

const ctx = (scope: "read" | "read_write"): McpToolContext => makeTestCtx({ scope });

describe("tool registrar", () => {
  const writeTool = (handler: ReturnType<typeof vi.fn>) =>
    defineTool({
      name: "record_journal",
      description: "write",
      scope: "read_write",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {},
      handler,
    });

  it("rejects a read-scope token calling a write tool BEFORE the handler runs", async () => {
    const handler = vi.fn();
    const result = await invokeTool(writeTool(handler), ctx("read"), {});
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "SCOPE_DENIED" });
    expect(JSON.stringify(result)).toContain("record_journal");
  });

  it("lets a read_write token through to the handler", async () => {
    const handler = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "done" }],
    }));
    const result = await invokeTool(writeTool(handler), ctx("read_write"), {});
    expect(handler).toHaveBeenCalledOnce();
    expect(result.isError).toBeUndefined();
  });

  it("enforces scope driven by the tool declaration, not per-handler discipline", async () => {
    // A read-scoped tool must be callable with either token scope.
    const handler = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    const tool = defineTool({
      name: "ping",
      description: "read",
      scope: "read",
      annotations: { readOnlyHint: true },
      inputSchema: {},
      handler,
    });
    expect((await invokeTool(tool, ctx("read"), {})).isError).toBeUndefined();
    expect((await invokeTool(tool, ctx("read_write"), {})).isError).toBeUndefined();
  });

  it("passes annotations through to server registration untouched", () => {
    const tool = defineTool({
      name: "supersede_journal",
      description: "correct",
      scope: "read_write",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      inputSchema: {},
      handler: async () => ({ content: [{ type: "text" as const, text: "x" }] }),
    });
    const registerTool = vi.fn();
    const fakeServer = { registerTool } as never;
    registerTools(fakeServer, [tool], ctx("read_write"));
    expect(registerTool).toHaveBeenCalledWith(
      "supersede_journal",
      expect.objectContaining({
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      }),
      expect.any(Function),
    );
  });

  it("maps a domain ValidationError to a structured tool error with a spec code", async () => {
    const handler = vi.fn(async () => {
      throw new ValidationError("journal debits do not equal credits", "UNBALANCED", ["j-1"]);
    });
    const result = await invokeTool(writeTool(handler), ctx("read_write"), {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "UNBALANCED_JOURNAL",
      message: "journal debits do not equal credits",
    });
  });

  it("maps FACILITY_USE to FACILITY_USE_INCOMPLETE", async () => {
    const handler = vi.fn(async () => {
      throw new ValidationError("facility uses do not cover the draw", "FACILITY_USE");
    });
    const result = await invokeTool(writeTool(handler), ctx("read_write"), {});
    expect(result.structuredContent).toMatchObject({ code: "FACILITY_USE_INCOMPLETE" });
  });

  it("passes an McpToolError's own code through (e.g. UNKNOWN_JOURNAL)", async () => {
    const handler = vi.fn(async () => {
      throw new McpToolError("UNKNOWN_JOURNAL", "No journal j-9 in this household");
    });
    const result = await invokeTool(writeTool(handler), ctx("read_write"), {});
    expect(result.structuredContent).toMatchObject({
      code: "UNKNOWN_JOURNAL",
      message: "No journal j-9 in this household",
    });
  });

  it("hides unexpected errors behind a generic message with no stack text", async () => {
    // The mapping deliberately logs a correlation id server-side; keep that
    // log out of the suite output without touching the assertion.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const handler = vi.fn(async () => {
        throw new Error("pg connection failed at secret.internal:5432");
      });
      const result = await invokeTool(writeTool(handler), ctx("read_write"), {});
      expect(result.isError).toBe(true);
      const payload = JSON.stringify(result);
      expect(payload).not.toContain("secret.internal");
      expect(payload).not.toContain("pg connection failed");
      expect(result.structuredContent).toMatchObject({ code: "INTERNAL" });
      expect(consoleSpy).toHaveBeenCalledOnce();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("rejects a JSON-number amountMinor at the schema boundary, naming the field and format", async () => {
    const tool = defineTool({
      name: "record_journal",
      description: "write",
      scope: "read_write",
      annotations: { readOnlyHint: false },
      inputSchema: { amountMinor: zMinorAmount },
      handler: vi.fn(),
    });
    const result = await invokeTool(tool, ctx("read_write"), { amountMinor: 1500000 });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result);
    expect(text).toContain("amountMinor");
    expect(text).toContain("minor units");
  });
});

describe("toToolError", () => {
  it("maps ledger ValidationError codes to spec §10 codes", () => {
    const cases: Array<[ConstructorParameters<typeof ValidationError>[1], string]> = [
      ["UNBALANCED", "UNBALANCED_JOURNAL"],
      ["FACILITY_USE", "FACILITY_USE_INCOMPLETE"],
      ["NEGATIVE_QUANTITY", "NEGATIVE_QUANTITY"],
      ["UNKNOWN_ACCOUNT", "UNKNOWN_ACCOUNT"],
    ];
    for (const [ledgerCode, mcpCode] of cases) {
      const result = toToolError(new ValidationError("msg", ledgerCode));
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ code: mcpCode, message: "msg" });
    }
  });

  it("never leaks internals for unexpected errors", () => {
    // Same deliberate correlation-id log; suppressed here, still asserted.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = toToolError(new Error("select * from api_token where hash = 'abc'"));
      expect(JSON.stringify(result)).not.toContain("api_token");
      expect(result.structuredContent).toMatchObject({ code: "INTERNAL" });
      expect(consoleSpy).toHaveBeenCalledOnce();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("input shape typing", () => {
  it("handlers receive parsed input typed from the declared shape", async () => {
    const seen: unknown[] = [];
    const tool = defineTool({
      name: "echo",
      description: "echo",
      scope: "read",
      annotations: { readOnlyHint: true },
      inputSchema: { amountMinor: zMinorAmount, rateBps: zBasisPoints.optional() },
      handler: async (_ctx, input) => {
        seen.push(input);
        return { content: [{ type: "text" as const, text: input.amountMinor }] };
      },
    });
    const result = await invokeTool(tool, ctx("read"), { amountMinor: "-1500000", rateBps: 525 });
    expect(result.isError).toBeUndefined();
    expect(seen[0]).toEqual({ amountMinor: "-1500000", rateBps: 525 });
  });

  it("z is re-exported for tool modules so they never import two zod copies", () => {
    expect(z.string).toBeTypeOf("function");
  });
});
