import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, createTokenRepo } from "@stonks/db";
import { account, apiToken, currency, household, journal, journalFacilityUse, posting } from "@stonks/db";
import { loadEnv } from "@/lib/env";
import { POST } from "@/app/api/mcp/[transport]/route";
import { MCP_TOOLS } from "@/lib/mcp/tools";

/**
 * Task 13 integration suite: the REAL route handler (`POST` from
 * `app/api/mcp/[transport]/route.ts`) over the REAL MCP transport
 * (mcp-handler, Streamable HTTP) against REAL Postgres, with two seeded
 * households and tokens minted through the Task 1 repo. This is the end-to-end
 * proof that tenant isolation, bearer auth, scope enforcement, and write
 * safety hold through the live path — not just against in-memory fakes.
 *
 * Skipped automatically when DATABASE_URL is absent, matching the
 * `describeIfDb` convention in packages/db. When it runs, it RUNS — the
 * assertions below are against the live server path.
 */

loadEnv();
const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

type JsonRpc = {
  jsonrpc: string;
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

/** A Streamable HTTP response is either plain JSON or an SSE stream. */
async function readRpc(res: Response): Promise<JsonRpc> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    const dataLines = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());
    if (dataLines.length === 0) throw new Error(`SSE response with no data lines: ${text}`);
    return JSON.parse(dataLines[dataLines.length - 1]!) as JsonRpc;
  }
  return (await res.json()) as JsonRpc;
}

let requestId = 0;
function rpcRequest(token: string | null, method: string, params?: unknown): Promise<Response> {
  requestId += 1;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return POST(
    new Request("http://localhost/api/mcp/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, ...(params ? { params } : {}) }),
    }),
  );
}

const INITIALIZE_PARAMS = {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "mcp-integration-test", version: "0.0.0" },
};

function toolResult(rpc: JsonRpc): {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
} {
  expect(rpc.error, JSON.stringify(rpc)).toBeUndefined();
  return rpc.result as never;
}

describeIfDb("MCP integration (real Postgres, real route handler)", () => {
  const db = createDb(databaseUrl!);
  const tokenRepo = createTokenRepo(db);

  const suffix = crypto.randomUUID().slice(0, 8);
  const householdA = crypto.randomUUID();
  const householdB = crypto.randomUUID();
  const cashA = `it-cash-a-${suffix}`;
  const worldA = `it-world-a-${suffix}`;
  const cashB = `it-cash-b-${suffix}`;
  const worldB = `it-world-b-${suffix}`;

  let readTokenA: string;
  let rwTokenA: string;
  let readTokenB: string;
  let rwTokenB: string;
  let rwTokenIdA: string;

  beforeAll(async () => {
    await db
      .insert(currency)
      .values({ code: "CAD", minorUnits: 2, name: "Canadian Dollar" })
      .onConflictDoNothing();
    await db.insert(household).values([
      { id: householdA, reportingCurrency: "CAD" },
      { id: householdB, reportingCurrency: "CAD" },
    ]);
    await db.insert(account).values([
      { id: cashA, householdId: householdA, type: "CASH", currency: "CAD", name: "IT Cash A" },
      { id: worldA, householdId: householdA, type: "EXTERNAL", currency: "CAD", name: "IT World A" },
      { id: cashB, householdId: householdB, type: "CASH", currency: "CAD", name: "IT Cash B" },
      { id: worldB, householdId: householdB, type: "EXTERNAL", currency: "CAD", name: "IT World B" },
    ]);

    readTokenA = (await tokenRepo.create(householdA, "it-read-a", "read")).token;
    ({ id: rwTokenIdA, token: rwTokenA } = await tokenRepo.create(householdA, "it-rw-a", "read_write"));
    readTokenB = (await tokenRepo.create(householdB, "it-read-b", "read")).token;
    rwTokenB = (await tokenRepo.create(householdB, "it-rw-b", "read_write")).token;
  });

  afterAll(async () => {
    // Journal rows first (postings/facility uses reference them), then tokens,
    // accounts, households.
    const journalIds = (
      await db
        .select({ id: journal.id })
        .from(journal)
        .where(eq(journal.householdId, householdA))
    ).map((row) => row.id);
    journalIds.push(
      ...(
        await db.select({ id: journal.id }).from(journal).where(eq(journal.householdId, householdB))
      ).map((row) => row.id),
    );
    for (const id of journalIds) {
      await db.delete(posting).where(eq(posting.journalId, id));
      await db.delete(journalFacilityUse).where(eq(journalFacilityUse.journalId, id));
      await db.delete(journal).where(eq(journal.id, id));
    }
    for (const hh of [householdA, householdB]) {
      await db.delete(apiToken).where(eq(apiToken.householdId, hh));
      await db.delete(account).where(eq(account.householdId, hh));
      await db.delete(household).where(eq(household.id, hh));
    }
  });

  describe("transport auth — rejected before any MCP processing", () => {
    it("no bearer token → 401 with WWW-Authenticate", async () => {
      const res = await rpcRequest(null, "initialize", INITIALIZE_PARAMS);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it("malformed Authorization header → 401", async () => {
      for (const header of ["Basic abc", "Bearer", "not-a-scheme"]) {
        requestId += 1;
        const res = await POST(
          new Request("http://localhost/api/mcp/mcp", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: header },
            body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method: "initialize", params: INITIALIZE_PARAMS }),
          }),
        );
        expect(res.status, header).toBe(401);
      }
    });

    it("unknown token → 401", async () => {
      const res = await rpcRequest("stk_this_token_was_never_minted", "initialize", INITIALIZE_PARAMS);
      expect(res.status).toBe(401);
    });

    it("a revoked token is rejected on its next use", async () => {
      const { id, token } = await tokenRepo.create(householdA, "it-ephemeral", "read");
      const before = await rpcRequest(token, "initialize", INITIALIZE_PARAMS);
      expect(before.status).toBe(200);

      expect(await tokenRepo.revoke(householdA, id)).toBe(true);

      const after = await rpcRequest(token, "initialize", INITIALIZE_PARAMS);
      expect(after.status).toBe(401);
    });
  });

  describe("live MCP flow", () => {
    it("initialize + tools/list exposes exactly the registry, annotated", async () => {
      const init = await readRpc(await rpcRequest(readTokenA, "initialize", INITIALIZE_PARAMS));
      expect(init.error).toBeUndefined();
      expect(init.result).toMatchObject({ serverInfo: { name: "stonks" } });

      const list = await readRpc(await rpcRequest(readTokenA, "tools/list"));
      const tools = (list.result as { tools: Array<{ name: string; annotations?: Record<string, unknown> }> }).tools;
      expect(tools.map((t) => t.name).sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
      for (const entry of tools) {
        const declared = MCP_TOOLS.find((t) => t.name === entry.name)!;
        expect(entry.annotations).toMatchObject({ readOnlyHint: declared.annotations.readOnlyHint! });
      }
    });

    it("ping resolves the household reporting currency end to end", async () => {
      const rpc = await readRpc(
        await rpcRequest(readTokenA, "tools/call", { name: "ping", arguments: {} }),
      );
      const result = toolResult(rpc);
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({ server: "stonks", reportingCurrency: "CAD" });
    });

    it("a read-scope token is SCOPE_DENIED on record_journal through the live path", async () => {
      const rpc = await readRpc(
        await rpcRequest(readTokenA, "tools/call", {
          name: "record_journal",
          arguments: {
            type: "DEPOSIT",
            tradeDate: "2024-04-01",
            postings: [
              { accountId: worldA, amountMinor: "-100" },
              { accountId: cashA, amountMinor: "100" },
            ],
          },
        }),
      );
      const result = toolResult(rpc);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ code: "SCOPE_DENIED" });
    });

    it("record → read back → supersede → history retained, replay reflects the correction", async () => {
      // Record a balanced deposit of 12345.00 CAD.
      const recorded = toolResult(
        await readRpc(
          await rpcRequest(rwTokenA, "tools/call", {
            name: "record_journal",
            arguments: {
              type: "DEPOSIT",
              tradeDate: "2024-04-01",
              memo: "integration deposit",
              postings: [
                { accountId: worldA, amountMinor: "-1234500" },
                { accountId: cashA, amountMinor: "1234500" },
              ],
            },
          }),
        ),
      );
      expect(recorded.isError).toBeUndefined();
      const journalId = recorded.structuredContent!.journalId as string;
      expect(typeof journalId).toBe("string");

      // Read it back: postings are minor-unit strings, sortKey server-assigned (0).
      const fetched = toolResult(
        await readRpc(await rpcRequest(readTokenA, "tools/call", { name: "get_journal", arguments: { journalId } })),
      );
      expect(fetched.structuredContent).toMatchObject({
        journal: {
          id: journalId,
          type: "DEPOSIT",
          tradeDate: "2024-04-01",
          sortKey: 0,
          status: "POSTED",
          postings: [
            { accountId: worldA, amountMinor: "-1234500", currency: "CAD" },
            { accountId: cashA, amountMinor: "1234500", currency: "CAD" },
          ],
        },
      });

      // Supersede without confirm: preview, nothing changes.
      const replacement = {
        type: "DEPOSIT",
        tradeDate: "2024-04-01",
        memo: "corrected deposit",
        postings: [
          { accountId: worldA, amountMinor: "-1234567" },
          { accountId: cashA, amountMinor: "1234567" },
        ],
      };
      const preview = toolResult(
        await readRpc(
          await rpcRequest(rwTokenA, "tools/call", {
            name: "supersede_journal",
            arguments: { journalId, replacement },
          }),
        ),
      );
      expect(preview.structuredContent).toMatchObject({ preview: true, confirmationRequired: true });
      const stillPosted = toolResult(
        await readRpc(await rpcRequest(readTokenA, "tools/call", { name: "get_journal", arguments: { journalId } })),
      );
      expect(stillPosted.structuredContent).toMatchObject({ journal: { status: "POSTED" } });

      // With confirm: the correction applies.
      const applied = toolResult(
        await readRpc(
          await rpcRequest(rwTokenA, "tools/call", {
            name: "supersede_journal",
            arguments: { journalId, replacement, confirm: true },
          }),
        ),
      );
      expect(applied.structuredContent).toMatchObject({
        preview: false,
        supersededJournalId: journalId,
      });
      const replacementId = applied.structuredContent!.replacementJournalId as string;

      // History is retained: the original is readable, marked SUPERSEDED, and
      // the chain resolves both directions.
      const original = toolResult(
        await readRpc(await rpcRequest(readTokenA, "tools/call", { name: "get_journal", arguments: { journalId } })),
      );
      expect(original.structuredContent).toMatchObject({
        journal: { id: journalId, status: "SUPERSEDED" },
        supersession: { supersededByJournalId: replacementId },
      });

      // Replay input (default list) shows only the corrected figure; the audit
      // view retains the original marked SUPERSEDED.
      const history = toolResult(
        await readRpc(await rpcRequest(readTokenA, "tools/call", { name: "list_journals", arguments: {} })),
      );
      const listed = history.structuredContent!.journals as Array<{ id: string }>;
      expect(listed.map((j) => j.id)).not.toContain(journalId);
      expect(listed.map((j) => j.id)).toContain(replacementId);

      const audit = toolResult(
        await readRpc(
          await rpcRequest(readTokenA, "tools/call", {
            name: "list_journals",
            arguments: { includeSuperseded: true },
          }),
        ),
      );
      const auditRows = audit.structuredContent!.journals as Array<{ id: string; status: string }>;
      expect(auditRows.find((j) => j.id === journalId)?.status).toBe("SUPERSEDED");
    });

    it("an unbalanced journal persists nothing at all through the live path", async () => {
      const rejected = toolResult(
        await readRpc(
          await rpcRequest(rwTokenA, "tools/call", {
            name: "record_journal",
            arguments: {
              type: "DEPOSIT",
              tradeDate: "2024-05-05",
              postings: [
                { accountId: worldA, amountMinor: "-50000" },
                { accountId: cashA, amountMinor: "49999" },
              ],
            },
          }),
        ),
      );
      expect(rejected.isError).toBe(true);
      expect(rejected.structuredContent).toMatchObject({ code: "UNBALANCED_JOURNAL" });

      // Verified at the database: no partial rows exist for that date.
      const rows = await db
        .select({ id: journal.id })
        .from(journal)
        .where(eq(journal.householdId, householdA));
      const listed = toolResult(
        await readRpc(
          await rpcRequest(readTokenA, "tools/call", {
            name: "list_journals",
            arguments: { includeSuperseded: true },
          }),
        ),
      );
      const wireIds = (listed.structuredContent!.journals as Array<{ id: string }>).map((j) => j.id);
      for (const row of rows) {
        expect(wireIds).toContain(row.id); // sanity: what the DB has, the tool shows
      }
      const mayFifth = toolResult(
        await readRpc(
          await rpcRequest(readTokenA, "tools/call", {
            name: "list_journals",
            arguments: { from: "2024-05-05", to: "2024-05-05", includeSuperseded: true },
          }),
        ),
      );
      expect(mayFifth.structuredContent!.journals).toEqual([]);
    });
  });

  describe("cross-household probes through the live path", () => {
    it("B's token cannot read A's journal by its real id", async () => {
      const aJournals = toolResult(
        await readRpc(await rpcRequest(readTokenA, "tools/call", { name: "list_journals", arguments: {} })),
      );
      const aId = (aJournals.structuredContent!.journals as Array<{ id: string }>)[0]!.id;

      const denied = toolResult(
        await readRpc(await rpcRequest(readTokenB, "tools/call", { name: "get_journal", arguments: { journalId: aId } })),
      );
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toMatchObject({ code: "UNKNOWN_JOURNAL" });
      // The error must not carry A's amounts or memo.
      expect(JSON.stringify(denied)).not.toContain("1234567");
      expect(JSON.stringify(denied)).not.toContain("corrected deposit");
    });

    it("B's read_write token cannot post into A's account, and nothing persists", async () => {
      const denied = toolResult(
        await readRpc(
          await rpcRequest(rwTokenB, "tools/call", {
            name: "record_journal",
            arguments: {
              type: "WITHDRAWAL",
              tradeDate: "2024-06-06",
              postings: [
                { accountId: worldB, amountMinor: "-100" },
                { accountId: cashA, amountMinor: "100" },
              ],
            },
          }),
        ),
      );
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toMatchObject({ code: "UNKNOWN_ACCOUNT" });

      const june = toolResult(
        await readRpc(
          await rpcRequest(readTokenA, "tools/call", {
            name: "list_journals",
            arguments: { from: "2024-06-06", to: "2024-06-06", includeSuperseded: true },
          }),
        ),
      );
      expect(june.structuredContent!.journals).toEqual([]);
    });

    it("B's list_journals never contains A's journals", async () => {
      const bList = toolResult(
        await readRpc(
          await rpcRequest(readTokenB, "tools/call", {
            name: "list_journals",
            arguments: { includeSuperseded: true },
          }),
        ),
      );
      expect(bList.structuredContent!.journals).toEqual([]);
    });

    it("revoking A's read_write token ends its access immediately", async () => {
      expect(await tokenRepo.revoke(householdA, rwTokenIdA)).toBe(true);
      const res = await rpcRequest(rwTokenA, "initialize", INITIALIZE_PARAMS);
      expect(res.status).toBe(401);
    });
  });
});
