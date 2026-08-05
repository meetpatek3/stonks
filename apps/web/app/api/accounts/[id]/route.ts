import { NextResponse } from "next/server";
import { createAccountRepo } from "@stonks/db";
import { closeAccountHandler } from "@/lib/accounts";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getPortfolioSnapshot } from "@/lib/portfolio";

/**
 * DELETE /api/accounts/[id] — close by stamping closed_at, scoped to the session household.
 * A foreign or unknown id is a 404. Account history is never deleted.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
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

  const { id } = await params;
  const result = await closeAccountHandler(id, {
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
