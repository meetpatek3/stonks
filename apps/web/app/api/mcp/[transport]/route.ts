import { createMcpHandler } from "mcp-handler";
import { createTokenRepo } from "@stonks/db";
import { getDb } from "@/lib/db";
import { authenticateMcpRequest } from "@/lib/mcp/auth";
import { createToolContext } from "@/lib/mcp/context";
import { registerTools } from "@/lib/mcp/registrar";
import { MCP_TOOLS } from "@/lib/mcp/tools";

/**
 * Streamable HTTP MCP endpoint (design spec §2) — stateless, bearer-auth.
 *
 * Auth happens HERE, before any MCP processing: no valid bearer token → HTTP
 * 401 and the request never reaches the MCP layer (spec §10). Scope failures
 * are different: they are tool errors (`SCOPE_DENIED`) raised by the
 * registrar so agents can report them legibly.
 *
 * `middleware.ts` exempts `/api/mcp` from cookie auth; this route does its
 * own. Per request we authenticate, build a household-scoped tool context,
 * and hand a fresh MCP server (registered with exactly `MCP_TOOLS`) to
 * `mcp-handler`. Stateless mode (`sessionIdGenerator: undefined`) keeps the
 * app self-hostable with no Redis.
 */
async function handleMcp(request: Request): Promise<Response> {
  const db = getDb();
  if (!db) {
    return Response.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const auth = await authenticateMcpRequest(
    request.headers.get("authorization"),
    createTokenRepo(db),
  );
  if (!auth) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  const ctx = createToolContext(db, auth);

  const handler = createMcpHandler(
    (server) => {
      registerTools(server, MCP_TOOLS, ctx);
    },
    {
      serverInfo: { name: "stonks", version: "0.1.0" },
      capabilities: { tools: {} },
    },
    {
      basePath: "/api/mcp",
      disableSse: true,
      sessionIdGenerator: undefined,
    },
  );

  return handler(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleMcp(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleMcp(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleMcp(request);
}
