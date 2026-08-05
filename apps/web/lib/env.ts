import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  // Local Docker lives in .env / .env.local. Neon production pull is `.env.vercel`
  // and is intentionally not loaded here — use `pnpm migrate:neon` for that.
  const candidates = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env.local"),
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../.env.local"),
    resolve(process.cwd(), "../.env"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      config({ path, override: false });
    }
  }
}

export function getDatabaseUrl(): string | undefined {
  loadEnv();
  return process.env.DATABASE_URL;
}

/**
 * DATABASE_URL for integration tests. Skips when unset; throws if pointed at a
 * remote host so a Vercel/Neon env pull cannot be hit by `pnpm test`.
 */
export function getTestDatabaseUrl(): string | undefined {
  const url = getDatabaseUrl();
  if (!url) return undefined;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${url}`);
  }

  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `Refusing integration tests against non-local DATABASE_URL host "${host}". ` +
        `Point .env.local at Docker Postgres (see .env.example). ` +
        `Keep Neon in .env.vercel and migrate with \`pnpm migrate:neon\`.`,
    );
  }

  return url;
}
