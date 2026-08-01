import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getPortfolioSnapshot } from "@/lib/portfolio";

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ balances: [], message: "DATABASE_URL not configured" });
  }

  try {
    const snapshot = await getPortfolioSnapshot(db, session.householdId);
    return NextResponse.json({
      householdId: snapshot.householdId,
      reportingCurrency: snapshot.reportingCurrency,
      ledgerVersion: snapshot.ledgerVersion,
      balances: snapshot.balances.map((row) => ({
        accountId: row.accountId,
        currency: row.currency,
        minor: row.minor,
        minorUnits: row.minorUnits,
      })),
      message: snapshot.message,
    });
  } catch (error) {
    console.error("balances route error:", error);
    return NextResponse.json({ balances: [], message: "failed to load balances" }, { status: 500 });
  }
}
