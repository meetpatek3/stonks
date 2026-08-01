import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/credentials";
import { createSessionToken, sessionCookieOptions } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export async function POST(request: Request): Promise<Response> {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const username =
    typeof body === "object" && body && "username" in body && typeof body.username === "string"
      ? body.username.trim()
      : "";
  const password =
    typeof body === "object" && body && "password" in body && typeof body.password === "string"
      ? body.password
      : "";

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  try {
    const user = await authenticate(db, username, password);
    if (!user) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    const token = await createSessionToken(user);
    const response = NextResponse.json({ ok: true, username: user.username });
    response.cookies.set(sessionCookieOptions(token));
    return response;
  } catch (error) {
    console.error("login error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
