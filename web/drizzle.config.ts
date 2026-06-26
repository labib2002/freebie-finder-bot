import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load .env.local for CLI commands (drizzle-kit doesn't read it automatically).
config({ path: ".env.local" });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
