import { NextResponse } from "next/server";
import { createFacilityTermsRepo } from "@stonks/db";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  createBenchmarkHandler,
  listBenchmarksHandler,
} from "@/lib/facility-terms";

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
  const result = await listBenchmarksHandler({
    session,
    repo: createFacilityTermsRepo(db),
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
  const result = await createBenchmarkHandler(body, {
    session,
    repo: createFacilityTermsRepo(db),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.body, { status: result.status });
}
