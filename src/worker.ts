import { getRuntime } from "./lib/runtime.ts";
import { deliverEmails } from "./email.ts";
const { store } = await getRuntime();
try {
  await store.tick();
  if ("sql" in store) console.log(await deliverEmails(store));
  else
    console.log(
      "Reminder inbox checked. Scheduled email requires DATABASE_URL.",
    );
} finally {
  await store.db.close();
}
