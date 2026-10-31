import { createAuth } from "../auth.ts";
import { seed } from "../seed.ts";
import { openPostgresStore } from "../postgres-store.ts";
async function initialize() {
  if (!process.env.DATABASE_URL)
    throw Error(
      "Configure DATABASE_URL with your Supabase PostgreSQL connection string.",
    );
  const store = openPostgresStore(process.env.DATABASE_URL);
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
