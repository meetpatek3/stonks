import { NextResponse } from "next/server";
import { createTokenRepo } from "@stonks/db";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { revokeTokenHandler } from "@/lib/tokens";

/**
 * DELETE /api/tokens/[id] — revoke immediately, scoped to the session household.
 * A foreign or unknown id is a 404, never another household's revocation.
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
  const result = await revokeTokenHandler(id, {
    session,
    repo: createTokenRepo(db),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.body, { status: result.status });
}
