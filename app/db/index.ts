import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// statement_timeout caps every query at 5s server-side — backstop against
// unauthenticated expensive queries (e.g. trigram cross-joins) monopolizing
// the shared pool. Keep in sync with the in-memory rate limiter (lib/rate-limit.ts).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  statement_timeout: 5_000,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle({ client: pool, schema });
export { schema };