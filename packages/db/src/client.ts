import { drizzle as drizzlePostgresJs } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

type Schema = typeof schema;

export type Db = PostgresJsDatabase<Schema>;

/** Neon / Vercel / pooler URLs need a single connection without prepared statements. */
export function isServerlessPostgres(connectionString: string): boolean {
  if (process.env.VERCEL) return true;
  return /neon\.tech|neon\.database|-pooler\./i.test(connectionString);
}

/**
 * Always use postgres.js so `db.transaction` works (journal writes).
 * On Vercel/Neon: `prepare: false` and `max: 1` per AGENTS.md.
 */
export function createDb(connectionString: string): Db {
  const serverless = isServerlessPostgres(connectionString);
  const client = postgres(connectionString, {
    max: serverless ? 1 : 10,
    prepare: false,
  });
  return drizzlePostgresJs(client, { schema });
}
