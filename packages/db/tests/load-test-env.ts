import { config } from "dotenv";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

/**
 * Loads repo-root local env for DB integration tests.
 * Refuses non-loopback hosts so a mistaken Neon pull cannot mutate production.
 */
export function loadTestDatabaseUrl(): string | undefined {
  config({ path: resolve(root, ".env.local") });
  config({ path: resolve(root, ".env") });

  const url = process.env.DATABASE_URL;
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
        `Use .env.vercel only for Neon ops via \`pnpm migrate:neon\`.`,
    );
  }

  return url;
}
