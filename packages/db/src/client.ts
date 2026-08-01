import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgresJs } from "drizzle-orm/postgres-js";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

type Schema = typeof schema;

export type Db =
  | NeonHttpDatabase<Schema>
  | PostgresJsDatabase<Schema>;

/** Neon / Vercel serverless must use HTTP — never postgres.js. */
export function shouldUseNeonHttp(connectionString: string): boolean {
  if (process.env.VERCEL) return true;
  return /neon\.tech|neon\.database|-pooler\./i.test(connectionString);
}

export function createDb(connectionString: string): Db {
  if (shouldUseNeonHttp(connectionString)) {
    const sql = neon(connectionString);
    return drizzleNeonHttp(sql, { schema });
  }

  const client = postgres(connectionString, {
    max: 10,
    prepare: false,
  });
  return drizzlePostgresJs(client, { schema });
}
