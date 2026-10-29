import { createAuth } from "../auth.ts";
import { seed } from "../seed.ts";
import { openPostgresStore } from "../postgres-store.ts";
async function initialize() {
  if (process.env.VERCEL && !process.env.DATABASE_URL)
    throw Error(
      "Configure DATABASE_URL for Supabase PostgreSQL before using Lineup on Vercel.",
    );
  const store = process.env.DATABASE_URL
    ? openPostgresStore(process.env.DATABASE_URL)
    : (await import("../store.ts")).openStore(
        process.env.DB_PATH || "data/reel.sqlite",
      );
  await seed(store);
  const auth = createAuth(store.db);
  return { store, auth };
}
let runtime: ReturnType<typeof initialize> | undefined;
export function getRuntime() {
  if (!runtime)
    runtime = initialize().catch((e) => {
      runtime = undefined;
      throw e;
    });
  return runtime;
}
