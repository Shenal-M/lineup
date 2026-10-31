// Applies supabase/migrations/*.sql in order to DATABASE_URL. Migrations are idempotent.
import { readdir, readFile } from "node:fs/promises";
import { openPostgresStore } from "../src/postgres-store.ts";

if (!process.env.DATABASE_URL) throw Error("Set DATABASE_URL in .env first.");
const dir = new URL("./migrations/", import.meta.url);
const { sql, db } = openPostgresStore(process.env.DATABASE_URL);
try {
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    await sql.unsafe(await readFile(new URL(file, dir), "utf8"));
    console.log(`Applied ${file}`);
  }
  const tables = await sql`select table_name from information_schema.tables where table_schema='public' order by 1`;
  console.log("Tables:", tables.map((t) => t.table_name).join(", "));
} finally {
  await db.close();
}
