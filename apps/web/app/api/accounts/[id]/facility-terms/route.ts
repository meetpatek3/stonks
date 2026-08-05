import { NextResponse } from "next/server";
import { createFacilityTermsRepo } from "@stonks/db";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  createFacilityTermsHandler,
  getFacilityTermsHandler,
} from "@/lib/facility-terms";

export async function GET(
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
  const result = await getFacilityTermsHandler(id, {
    session,
    repo: createFacilityTermsRepo(db),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(
  request: Request,
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { id } = await params;
  const result = await createFacilityTermsHandler(id, body, {
    session,
    repo: createFacilityTermsRepo(db),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.body, { status: result.status });
}
