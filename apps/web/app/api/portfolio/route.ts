import { NextResponse } from "next/server";
import { demoPortfolio } from "../../../lib/demo-portfolio";

export const dynamic = "force-dynamic";

export async function GET() {
  // Preview / no-DB path serves the demo household. When Postgres is configured,
  // later iterations can replay journals and replace this payload.
  return NextResponse.json(demoPortfolio);
}
