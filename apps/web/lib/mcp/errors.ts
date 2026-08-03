import { ValidationError } from "@stonks/ledger";

/**
 * MCP tool error semantics (design spec §10).
 *
 * Domain failures become structured tool errors (`isError: true`) carrying a
 * stable `code`, an actionable `message`, and an optional `hint` — never a
 * bare 500, never a swallowed failure. Unexpected exceptions become a generic
 * message keyed by a server-side correlation id; stack traces, SQL, and
 * internal hostnames never reach the client.
 *
 * Auth failures are NOT handled here: they are HTTP 401 before any MCP
 * processing (see `auth.ts` and the route). Scope failures are tool errors
 * (`SCOPE_DENIED`) raised by the registrar so an agent can report them
 * legibly.
 */

export const TOOL_ERROR_CODES = [
  "UNBALANCED_JOURNAL",
  "FACILITY_USE_INCOMPLETE",
  "NEGATIVE_QUANTITY",
  "UNKNOWN_ACCOUNT",
  "UNKNOWN_JOURNAL",
  "CROSS_HOUSEHOLD_DENIED",
  "SCOPE_DENIED",
  "CONFIRMATION_REQUIRED",
  "DUPLICATE_NATURAL_KEY",
  "PRICE_NOT_FOUND",
  "ACCOUNT_NOT_EMPTY",
  /** Input failed its Zod schema; the message names the field and format. */
  "INVALID_INPUT",
  /** A supersession target that exists but is not POSTED. */
  "NOT_POSTED",
  /** Domain validation without a more specific spec code. */
  "VALIDATION",
  /** Unexpected failure; details are server-side under a correlation id. */
  "INTERNAL",
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export type ToolErrorResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: {
    code: ToolErrorCode;
    message: string;
    hint?: string;
    correlationId?: string;
  };
  isError: true;
};

/** A domain error a tool handler raises deliberately; its code survives mapping. */
export class McpToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

export function toolError(
  code: ToolErrorCode,
  message: string,
  hint?: string,
): ToolErrorResult {
  return {
    content: [{ type: "text", text: hint ? `${message}\n${hint}` : message }],
    structuredContent: hint ? { code, message, hint } : { code, message },
    isError: true,
  };
}

/** Ledger validation codes → spec §10 codes. */
const LEDGER_CODE_MAP: Record<ValidationError["code"], ToolErrorCode> = {
  UNBALANCED: "UNBALANCED_JOURNAL",
  FACILITY_USE: "FACILITY_USE_INCOMPLETE",
  NEGATIVE_QUANTITY: "NEGATIVE_QUANTITY",
  UNKNOWN_ACCOUNT: "UNKNOWN_ACCOUNT",
  UNKNOWN_JOURNAL: "UNKNOWN_JOURNAL",
  NOT_POSTED: "NOT_POSTED",
  CURRENCY: "VALIDATION",
  MISSING_COST: "VALIDATION",
  COST_CURRENCY: "VALIDATION",
};

/**
 * Map any thrown value to a structured tool error. Deliberate domain errors
 * keep their code and message; anything unexpected is replaced with a generic
 * message and logged server-side under a correlation id.
 */
export function toToolError(error: unknown): ToolErrorResult {
  if (error instanceof McpToolError) {
    return toolError(error.code, error.message, error.hint);
  }
  if (error instanceof ValidationError) {
    return toolError(LEDGER_CODE_MAP[error.code], error.message);
  }

  const correlationId = crypto.randomUUID();
  console.error(`MCP tool failure (correlation ${correlationId})`, error);
  return {
    content: [
      {
        type: "text",
        text: `Unexpected tool error. Report correlation id ${correlationId} to the server operator.`,
      },
    ],
    structuredContent: {
      code: "INTERNAL",
      message: "Unexpected tool error",
      correlationId,
    },
    isError: true,
  };
}
