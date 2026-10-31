import { getRuntime } from "./lib/runtime.ts";
import { deliverEmails, emailConfigured } from "./email.ts";
import { deliverPushesSafely } from "./push.ts";
import { refreshFollowed } from "./sync.ts";
const { store } = await getRuntime();
try {
  const checked = await refreshFollowed(store, { force: true });
  if (checked !== null) console.log(`Checked ${checked} followed titles against TMDB.`);
  await store.tick();
  const push = await deliverPushesSafely(store);
  console.log(
    push === "not configured"
      ? "Phone notifications off. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to send them."
      : { push },
  );
  console.log(
    emailConfigured()
      ? await deliverEmails(store)
      : "Reminder inbox checked. Set RESEND_API_KEY and EMAIL_FROM to send email.",
  );
} finally {
  await store.db.close();
}
