import { createDb, type Db } from "@stonks/db";
import { getDatabaseUrl } from "./env";

let db: Db | undefined;

export function getDb(): Db | undefined {
  const url = getDatabaseUrl();
  if (!url) return undefined;
  if (!db) {
    db = createDb(url);
  }
  return db;
}
