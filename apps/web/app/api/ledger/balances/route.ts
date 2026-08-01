import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPortfolioSnapshot } from "@/lib/portfolio";

export async function GET(): Promise<Response> {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ balances: [], message: "DATABASE_URL not configured" });
  }

  try {
    const snapshot = await getPortfolioSnapshot(db);
    return NextResponse.json({
      householdId: snapshot.householdId,
      reportingCurrency: snapshot.reportingCurrency,
      ledgerVersion: snapshot.ledgerVersion,
      balances: snapshot.balances.map((row) => ({
        accountId: row.accountId,
        currency: row.currency,
        minor: row.minor,
      })),
      message: snapshot.message,
    });
  } catch (error) {
    console.error("balances route error:", error);
    return NextResponse.json({ balances: [], message: "failed to load balances" }, { status: 500 });
  }
}
