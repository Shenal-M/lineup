import { openStore } from "../store";
import { createAuth } from "../auth";
import { seed } from "../seed";
type Runtime = {
  store: ReturnType<typeof openStore>;
  auth: ReturnType<typeof createAuth>;
  timer: ReturnType<typeof setInterval>;
};
const globalRuntime = globalThis as typeof globalThis & {
  lineupRuntime?: Runtime;
};
export function getRuntime(): Runtime {
  if (!globalRuntime.lineupRuntime) {
    const store = openStore(process.env.DB_PATH || "data/reel.sqlite");
    seed(store);
    const auth = createAuth(store.db);
    const timer = setInterval(() => {
      try {
        store.tick();
      } catch (error) {
        console.error("Reminder check failed", error);
      }
    }, 60_000);
    timer.unref();
    globalRuntime.lineupRuntime = { store, auth, timer };
  }
  return globalRuntime.lineupRuntime;
}
