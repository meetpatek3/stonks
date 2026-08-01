import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

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
