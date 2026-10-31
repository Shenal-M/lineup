import { getRuntime } from "./lib/runtime.ts";
import { deliverEmails, emailConfigured } from "./email.ts";
import { refreshFollowed } from "./sync.ts";
const { store } = await getRuntime();
try {
  const checked = await refreshFollowed(store, { force: true });
  if (checked !== null) console.log(`Checked ${checked} followed titles against TMDB.`);
  await store.tick();
  console.log(
    emailConfigured()
      ? await deliverEmails(store)
      : "Reminder inbox checked. Set RESEND_API_KEY and EMAIL_FROM to send email.",
  );
} finally {
  await store.db.close();
}
