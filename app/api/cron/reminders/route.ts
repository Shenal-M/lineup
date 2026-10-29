import { timingSafeEqual } from "node:crypto";
import { getRuntime } from "../../../../src/lib/runtime";
import { deliverEmails } from "../../../../src/email";
export const runtime = "nodejs";
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
  try {
    const { store } = await getRuntime();
    if (!("sql" in store))
      return Response.json(
        { error: "Scheduled email delivery requires DATABASE_URL." },
        { status: 503 },
      );
    await store.tick();
    const result = await deliverEmails(store);
    return Response.json(result, {
      status: result.failed ? 502 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    console.error(
      "Scheduled reminder delivery failed; check database and email configuration.",
    );
    return Response.json(
      {
        error:
          "Reminder job failed; check database migrations and email configuration.",
      },
      { status: 503 },
    );
  }
}
