import { titleDetails } from "./providers.ts";
import type { Store } from "./postgres-store.ts";
// Followed titles are re-checked against TMDB about twice a day; each check is one
// cached TMDB request per title and one locked write for all of them.
const STALE_MS = 12 * 3600000,
  RETRY_MS = 3600000;
// When the next check is due (a failed check is retried after an hour).
const dueAt = (health: any) =>
  health ? Date.parse(health.updatedAt) + (health.state === "ok" ? STALE_MS : RETRY_MS) : 0;
let running: Promise<number | null> | null = null,
  // Known per instance, so page loads before then skip the database read.
  nextAt = 0;
export function refreshFollowed(store: Store, { force = false } = {}) {
  if (!force && Date.now() < nextAt) return Promise.resolve(null);
  running ??= (async () => {
    if (!process.env.TMDB_TOKEN) return null;
    nextAt = dueAt(await store.get("health", "tmdb"));
    if (!force && Date.now() < nextAt) return null;
    const titles = (await store.all("titles")).filter((t) => /^tmdb-(movie|tv)-\d+$/.test(t.id));
    const results = await Promise.allSettled(titles.map((t) => titleDetails(t.id)));
    const entries = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failed = results.length - entries.length;
    const count = entries.length ? await store.refresh(entries) : 0;
    const health = {
      id: "tmdb",
      state: failed ? "error" : "ok",
      updatedAt: new Date().toISOString(),
      note: failed
        ? `${failed} of ${titles.length} followed titles could not be checked.`
        : `Checked ${count} followed titles.`,
    };
    nextAt = dueAt(health);
    await store.put("health", health);
    return count;
  })().finally(() => {
    running = null;
  });
  return running;
}
