import { NextResponse } from "next/server";
import { createAccountRepo } from "@stonks/db";
import { createAccountHandler, listAccountsHandler } from "@/lib/accounts";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getPortfolioSnapshot } from "@/lib/portfolio";

/**
 * GET /api/accounts — list the session household's accounts and known currencies.
 * POST /api/accounts — create an account scoped to the session household.
 */
export async function GET(request: Request): Promise<Response> {
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

  const includeClosed = new URL(request.url).searchParams.get("includeClosed") === "true";
  const result = await listAccountsHandler(includeClosed, {
    session,
    repo: createAccountRepo(db),
    portfolio: {
      getSnapshot: (householdId) => getPortfolioSnapshot(db, householdId),
    },
  });
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

  const result = await createAccountHandler(body, {
    session,
    repo: createAccountRepo(db),
    portfolio: {
      getSnapshot: (householdId) => getPortfolioSnapshot(db, householdId),
    },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.body, { status: result.status });
}
