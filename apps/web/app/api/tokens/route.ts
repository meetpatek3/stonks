import { NextResponse } from "next/server";
import { createTokenRepo } from "@stonks/db";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { createTokenHandler, listTokensHandler } from "@/lib/tokens";

/**
 * GET /api/tokens — list the session household's API tokens (no hashes, no plaintext).
 * POST /api/tokens — mint a token; the plaintext is returned exactly once, here only.
 * Cookie-authenticated; deliberately not exposed over MCP.
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 503 },
    );
  }

  const result = await listTokensHandler({ session, repo: createTokenRepo(db) });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await createTokenHandler(body, {
    session,
    repo: createTokenRepo(db),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.body, { status: result.status });
}
