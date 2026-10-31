import type { Store } from "./postgres-store.ts";
// Cold start: a plain unlocked existence check (one round trip); default settings are
// written only on the very first run. There is no sample catalogue: titles come from
// TMDB and only followed titles are stored.
export async function seed(store: Pick<Store, "get" | "ensureSettings">) {
  if (await store.get("settings", "user")) return;
  await store.ensureSettings({ id: "user", market: "US", timezone: "Asia/Colombo", hour: 9 });
}
