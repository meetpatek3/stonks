import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AccountRepo, ApiTokenScope, JournalListFilters } from "@stonks/db";
import type { Journal, PriceOverride, PriceQuote } from "@stonks/ledger";
import { z } from "zod";
import type { InterestAttributionReadModel } from "@/lib/portfolio-derive";
import type { PortfolioSnapshot } from "@/lib/portfolio-shared";
import { toolError, toToolError } from "./errors";

/**
 * The tool registrar — every MCP tool is declared through `defineTool` and
 * invoked through `invokeTool`, which is the single enforcement point for
 * scope, schema validation, and error mapping (design spec §3, §10).
 *
 * Scope is driven by each tool's DECLARATION and checked before the handler
 * runs — never by per-handler discipline a future tool could forget. Tool
 * handlers are pure `(ctx, input)` functions with repos injected through
 * `ctx`, so unit tests need no HTTP server and no database.
 *
 * Money typing note: input schemas come from `lib/mcp/schemas.ts`. Amounts,
 * quantities, and FX rates are strings on the wire; only basis points and
 * count-like fields may be JSON numbers.
 */

export type ToolScope = "read" | "read_write";

export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

/** Structured tool result, matching the SDK's CallToolResult shape. */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Household-scoped reads that are not journals/accounts/prices. Kept behind
 * an interface so tests inject in-memory fakes.
 */
export interface HouseholdInfoRepo {
  /** The household's reporting currency, or null when the household is gone. */
  getReportingCurrency(householdId: string): Promise<string | null>;
}

/**
 * The portfolio read model, as a repo-shaped dependency. Production wires
 * this to `getPortfolioSnapshot`; tests inject a hand-built snapshot. Every
 * figure it returns is derived by replay — tool handlers never compute a
 * balance, cost basis, or return themselves.
 */
export interface PortfolioSnapshotRepo {
  getSnapshot(
    householdId: string,
    options?: { taxYear?: number; asOf?: string },
  ): Promise<PortfolioSnapshot>;
}

/** Read-model attribution, kept separate from snapshot reads because it has a date range. */
export interface InterestAttributionRepo {
  getAttribution(
    householdId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<InterestAttributionReadModel>;
}

/** The price persistence seam used by the MCP read and override tools. */
export interface McpPriceRepo {
  getSecurity(
    securityId: string,
  ): Promise<{ id: string; currency: string; minorUnits: number } | null>;
  listOverrides(householdId: string): Promise<PriceOverride[]>;
  latestQuoteAsOf(
    securityId: string,
    currency: string,
    asOf: string,
  ): Promise<PriceQuote | null>;
  insertOverride(
    householdId: string,
    override: PriceOverride & { createdBy: string },
  ): Promise<void>;
}

/** The journal-history reads, narrowed from `JournalRepo` so fakes stay small. */
export interface JournalReadRepo {
  listAll(householdId: string, filters?: JournalListFilters): Promise<Journal[]>;
  getById(householdId: string, id: string): Promise<Journal | null>;
  findSupersedingId(householdId: string, journalId: string): Promise<string | null>;
}

/**
 * The journal mutations, narrowed from `JournalRepo`. Every method here
 * appends or supersedes — there is deliberately no update/delete path, since
 * journals are immutable and corrections happen only by supersession.
 * Production wires this to the same `createJournalRepo(db)` instance as the
 * read side.
 */
export interface JournalWriteRepo {
  insertPosted(journal: Journal, householdId: string): Promise<void>;
  supersedePosted(householdId: string, oldId: string, replacement: Journal): Promise<void>;
  /** Next free POSTED sort_key for (household, trade_date) — server-assigned only. */
  nextSortKey(householdId: string, tradeDate: string): Promise<number>;
  /** Idempotency lookup for `externalNaturalKey`, household-scoped. */
  findByNaturalKey(householdId: string, key: string): Promise<string | null>;
}

/** Repos injected into every tool handler. Later tasks extend this. */
export interface McpRepos {
  household: HouseholdInfoRepo;
  portfolio: PortfolioSnapshotRepo;
  interest: InterestAttributionRepo;
  prices: McpPriceRepo;
  accounts: AccountRepo;
  journals: JournalReadRepo;
  journalWrites: JournalWriteRepo;
}

export interface McpToolContext {
  /** From the bearer token only — every repo call must filter by this. */
  householdId: string;
  scope: ApiTokenScope;
  repos: McpRepos;
}

type ZodShape = Record<string, z.ZodType>;

export interface ToolDefinition<Shape extends ZodShape> {
  name: string;
  description: string;
  /** Minimum token scope required. Enforced by the registrar, centrally. */
  scope: ToolScope;
  annotations: ToolAnnotations;
  inputSchema: Shape;
  handler: (
    ctx: McpToolContext,
    input: z.infer<z.ZodObject<Shape>>,
  ) => Promise<ToolResult>;
}

/** Identity helper giving tool modules one typed declaration site. */
export function defineTool<Shape extends ZodShape>(
  def: ToolDefinition<Shape>,
): ToolDefinition<Shape> {
  return def;
}

/**
 * The registry's element type. Tools are heterogeneous in their input shape;
 * per-tool input types stay fully checked at the `defineTool` call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any>;

/**
 * Invoke a tool against raw (untrusted) input:
 *   1. scope check — before parsing, before the handler;
 *   2. schema validation — failures name the field and the expected format;
 *   3. handler — thrown errors map through `toToolError` (spec §10).
 */
export async function invokeTool<Shape extends ZodShape>(
  def: ToolDefinition<Shape>,
  ctx: McpToolContext,
  rawInput: unknown,
): Promise<ToolResult> {
  if (def.scope === "read_write" && ctx.scope !== "read_write") {
    return toolError(
      "SCOPE_DENIED",
      `Tool "${def.name}" requires read_write scope; the token's scope is "${ctx.scope}".`,
      "Use a token with read_write scope, or mint one in the app's Settings page.",
    );
  }

  const parsed = z.object(def.inputSchema).safeParse(rawInput ?? {});
  if (!parsed.success) {
    return toolError("INVALID_INPUT", formatSchemaIssues(parsed.error));
  }

  try {
    return await def.handler(ctx, parsed.data);
  } catch (error) {
    return toToolError(error);
  }
}

/** `postings.0.amountMinor: must be a string of integer minor units ...` */
function formatSchemaIssues(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "input";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
  return `Invalid tool input — ${details}`;
}

/**
 * Register declared tools on an MCP server. The SDK callback delegates
 * straight to `invokeTool`, so the live path and the unit-tested path are
 * the same code.
 */
export function registerTools(
  server: McpServer,
  tools: ReadonlyArray<AnyToolDefinition>,
  ctx: McpToolContext,
): void {
  for (const def of tools) {
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.annotations,
      },
      (args: Record<string, unknown>) => invokeTool(def, ctx, args),
    );
  }
}
