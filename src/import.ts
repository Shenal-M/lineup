import { getRuntime } from "./lib/runtime.ts";
import { importTheatrical } from "./providers.ts";
const { store } = await getRuntime();
const month = process.argv[2] || new Date().toISOString().slice(0, 7);
const market = process.argv[3] || "US";
if (
  !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
  !["US", "GB", "LK"].includes(market)
)
  throw Error("Usage: npm run import -- YYYY-MM US|GB|LK");
const end = new Date(month + "-01T12:00Z");
end.setUTCMonth(end.getUTCMonth() + 1);
end.setUTCDate(0);
try {
  console.log(
    `Imported ${await importTheatrical(store, market, month + "-01", end.toISOString().slice(0, 10))} release events`,
  );
} finally {
  await store.db.close();
}
