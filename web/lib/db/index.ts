import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

/**
 * postgres-js client. We run on the Node.js serverless runtime (not Edge), so a
 * standard TCP connection works with Neon. `prepare: false` keeps it compatible
 * with connection poolers (pgbouncer / Neon pooled endpoint).
 */
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
