import { timingSafeEqual } from "node:crypto";
import { getRuntime } from "../../../../src/lib/runtime";
import { deliverEmails, emailConfigured } from "../../../../src/email";
import { deliverPushesSafely } from "../../../../src/push";
import { refreshFollowed } from "../../../../src/sync";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : "";
  const received = request.headers.get("authorization") || "";
  if (
    !expected ||
    Buffer.byteLength(expected) !== Buffer.byteLength(received) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const headers = { "Cache-Control": "no-store" };
  try {
    const { store } = await getRuntime();
    // A failed TMDB check is recorded in health; reminders still go out.
    await refreshFollowed(store).catch((e) =>
      console.error("Refreshing followed titles failed:", e instanceof Error ? e.message : e),
    );
    await store.tick();
    // Phone notifications are best effort: failures are logged and counted, never thrown.
    const push = await deliverPushesSafely(store);
    // Without email configuration the job still keeps the in-app inbox current.
    if (!emailConfigured())
      return Response.json({ tick: "ok", email: "not configured", push }, { headers });
    const result = await deliverEmails(store);
    return Response.json(
      { tick: "ok", ...result, push },
      { status: result.failed ? 502 : 200, headers },
    );
  } catch (e) {
    console.error(
      "Scheduled reminder job failed; check database migrations and email configuration:",
      e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    );
    return Response.json(
      {
        error:
          "Reminder job failed; check database migrations and email configuration.",
      },
      { status: 503, headers },
    );
  }
}
