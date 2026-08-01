import { config } from "dotenv";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: resolve(process.cwd(), "../../.env") });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
await client.end();

console.log("Migrations applied");
