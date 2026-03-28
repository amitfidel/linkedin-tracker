import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

// Local dev:  DATABASE_URL=file:./data/tracker.db  (no auth token needed)
// Production: DATABASE_URL=libsql://xxx.turso.io  + DATABASE_AUTH_TOKEN=xxx
const client = createClient({
  url: process.env.DATABASE_URL ?? "file:./data/tracker.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
export { schema };
