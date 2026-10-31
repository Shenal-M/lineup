import { getRuntime } from "./lib/runtime.ts";
import { deliverEmails, emailConfigured } from "./email.ts";
const { store } = await getRuntime();
try {
  await store.tick();
  console.log(
    emailConfigured()
      ? await deliverEmails(store)
      : "Reminder inbox checked. Set RESEND_API_KEY and EMAIL_FROM to send email.",
  );
} finally {
  await store.db.close();
}
