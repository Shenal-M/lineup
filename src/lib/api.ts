import { randomUUID, timingSafeEqual } from "node:crypto";
import { emailConfigured } from "../email";
import { getRuntime } from "./runtime";
import { clientAddress } from "../auth";
import { HttpError, ValidationError } from "../model";
import {
  searchTMDB,
  importTheatrical,
  hydrateTitle,
  hydrateSeason,
} from "../providers";

const MARKETS = ["US", "GB", "LK"];
const MEDIA = ["theatrical", "streaming"];
const RULES = ["announced", "changed", "week", "day", "release"];
const PRECISIONS = ["day", "month", "quarter", "year", "unknown"];
const STATUSES = ["announced", "estimated", "postponed", "cancelled", "first_observed"];

const isDate = (d: unknown): d is string =>
  typeof d === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  new Date(d + "T12:00Z").toISOString().slice(0, 10) === d;
const decode = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ValidationError("Invalid path");
  }
};
const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
// Error details stay in server logs; responses carry generic messages.
const describe = (e: unknown) =>
  e instanceof Error
    ? `${e.name}${(e as any).code ? ` [${(e as any).code}]` : ""}: ${e.message}`
    : String(e);

// Builds the stored release from an explicit field allowlist.
function releaseFrom(
  input: any,
  fixed: { id: string; titleId: string; revision: number },
) {
  const { market, medium, precision, status } = input;
  if (
    !MARKETS.includes(market) ||
    !MEDIA.includes(medium) ||
    !PRECISIONS.includes(precision) ||
    !STATUSES.includes(status)
  )
    throw new ValidationError("Invalid release fields");
  let date: string | null = null,
    endDate: string | null = null;
  if (precision !== "unknown") {
    if (!isDate(input.date)) throw new ValidationError("Enter a valid date");
    date = input.date;
    if (input.endDate != null && input.endDate !== "") {
      if (!isDate(input.endDate)) throw new ValidationError("Enter a valid end date");
      if (input.endDate < input.date) throw new ValidationError("End date must not be before the date");
      endDate = input.endDate;
    }
  }
  const source = text(input.source, 300);
  if (!source) throw new ValidationError("A source note is required");
  const sourceUrl = text(input.sourceUrl, 2000);
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl))
    throw new ValidationError("Source must be an HTTP URL");
  if (medium === "streaming" && input.offer !== "subscription")
    throw new ValidationError("Only subscription premieres are supported");
  const service = medium === "streaming" ? text(input.service, 60) || null : null;
  return {
    id: fixed.id,
    titleId: fixed.titleId,
    market,
    medium,
    service,
    offer: medium === "streaming" ? "subscription" : "ticket",
    date,
    ...(endDate ? { endDate } : {}),
    precision,
    status,
    source,
    sourceUrl,
    revision: fixed.revision,
    manual: true,
  };
}

// Validated follow preferences from an explicit field allowlist.
function followFrom(body: any) {
  const invalid = new ValidationError("Invalid follow preferences");
  if (
    typeof body.titleId !== "string" ||
    !body.titleId ||
    body.titleId.length > 200 ||
    !MARKETS.includes(body.market) ||
    !MEDIA.includes(body.medium) ||
    !Array.isArray(body.services) ||
    body.services.length > 10 ||
    !Array.isArray(body.rules) ||
    body.rules.length > 10
  )
    throw invalid;
  const services = body.services.map((s: unknown) =>
    typeof s === "string" ? s.trim() : "",
  );
  if (services.some((s: string) => !s || s.length > 60)) throw invalid;
  if (body.rules.some((r: unknown) => !RULES.includes(r as string))) throw invalid;
  return {
    titleId: body.titleId as string,
    market: body.market as string,
    medium: body.medium as string,
    services: [...new Set<string>(services)],
    rules: RULES.filter((r) => body.rules.includes(r)),
    channel: body.scope === "channel",
  };
}

export async function handleApi(request: Request) {
  let initialized = false;
  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  const req = {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
  };
  const res = {
    setHeader: (key: string, value: string) => responseHeaders.set(key, value),
  };
  const send = (status: number, data: unknown) =>
    Response.json(data, { status, headers: responseHeaders });
  const u = new URL(request.url);
  try {
    const { store, auth } = await getRuntime();
    initialized = true;
    if (!["GET", "HEAD"].includes(req.method || "")) {
      const origin = req.headers.origin;
      if (
        origin &&
        origin !== `http://${req.headers.host}` &&
        origin !== `https://${req.headers.host}`
      )
        return send(403, { error: "Cross-origin write rejected" });
    }
    let body: any = {};
    if (["POST", "PATCH"].includes(req.method || "")) {
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 65536)
        return send(413, { error: "Request too large" });
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        throw new ValidationError("Invalid JSON body");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new ValidationError("Invalid request body");
    }
    if (u.pathname === "/api/auth/status" && req.method === "GET") {
      const [signedIn, owner] = await Promise.all([
        auth.authenticated(req),
        auth.user(),
      ]);
      return send(200, {
        setupRequired: !owner,
        setupKeyRequired: !!process.env.SETUP_KEY,
        authenticated: signedIn,
        user: signedIn ? owner : null,
      });
    }
    const address = clientAddress(req.headers);
    if (u.pathname === "/api/auth/setup" && req.method === "POST") {
      if (
        (process.env.COOKIE_SECURE === "true" || process.env.VERCEL) &&
        !process.env.SETUP_KEY &&
        !(await auth.user())
      )
        return send(503, {
          error:
            "Configure SETUP_KEY on the server before creating the hosted account.",
        });
      const key = String(body.setupKey || "");
      const expectedKey = process.env.SETUP_KEY;
      if (
        expectedKey &&
        (Buffer.byteLength(key) !== Buffer.byteLength(expectedKey) ||
          !timingSafeEqual(Buffer.from(key), Buffer.from(expectedKey)))
      )
        return send(403, { error: "The setup key is incorrect." });
      return send(200, {
        user: await auth.setup(
          String(body.email || "").trim(),
          String(body.password || ""),
          res,
        ),
      });
    }
    if (u.pathname === "/api/auth/login" && req.method === "POST") {
      const result = await auth.signIn(
        String(body.email || "").trim(),
        String(body.password || "").slice(0, 257),
        address,
        res,
      );
      return send(result.status, result);
    }
    if (u.pathname === "/api/auth/logout" && req.method === "POST") {
      await auth.logout(req, res);
      return send(200, { ok: true });
    }
    const signedIn = await auth.authenticated(req);
    const bearer = req.headers.authorization || "";
    const expected = process.env.APP_TOKEN
      ? "Bearer " + process.env.APP_TOKEN
      : "";
    const serviceAuth =
      !!expected &&
      Buffer.byteLength(bearer) === Buffer.byteLength(expected) &&
      timingSafeEqual(Buffer.from(bearer), Buffer.from(expected));
    if (!signedIn && !serviceAuth)
      return send(401, { error: "Sign in to access your Lineup." });
    if (u.pathname === "/api/auth/password" && req.method === "POST") {
      if (!signedIn) return send(401, { error: "Sign in first." });
      await auth.changePassword(
        String(body.currentPassword || ""),
        String(body.password || ""),
        address,
        res,
      );
      return send(200, { ok: true });
    }
    if (u.pathname === "/api/state" && req.method === "GET") {
      // Reminder checks are best effort here: the cron job is the source of truth.
      try {
        await store.tickIfStale();
      } catch (e) {
        console.error("Reminder check during state load failed:", describe(e));
      }
      const data = await store.stateData();
      return send(200, {
        ...data,
        settings: data.settings.find((x) => x.id === "user") || null,
        sources: {
          tmdb: !!process.env.TMDB_TOKEN,
          streaming: false,
          email: emailConfigured(),
        },
      });
    }
    if (u.pathname === "/api/search" && req.method === "GET") {
      const q = (u.searchParams.get("q") || "").slice(0, 200);
      if (!q.trim()) return send(200, []);
      if (process.env.TMDB_TOKEN) {
        const rows = await searchTMDB(q);
        // One statement; richer stored titles (hydrated details) keep their fields.
        await store.putMany("titles", rows, { merge: true });
        return send(200, rows);
      }
      return send(
        200,
        (await store.all("titles")).filter((t) =>
          String(t.name || "").toLowerCase().includes(q.toLowerCase()),
        ),
      );
    }
    const titleRoute = u.pathname.match(
      /^\/api\/titles\/([^/]+)(?:\/seasons\/(\d+))?$/,
    );
    if (titleRoute && req.method === "GET") {
      const season = titleRoute[2] ? Number(titleRoute[2]) : null;
      if (season !== null && (season < 1 || season > 100))
        throw new ValidationError("Invalid season");
      const title = await store.get("titles", decode(titleRoute[1]));
      if (!title) return send(404, { error: "Title not found" });
      if (!process.env.TMDB_TOKEN || !title.tmdbId) return send(200, title);
      const hydrated =
        season !== null
          ? await hydrateSeason(title, season)
          : await hydrateTitle(title);
      await store.put("titles", hydrated);
      return send(200, hydrated);
    }
    if (u.pathname === "/api/subscriptions" && req.method === "POST") {
      const f = followFrom(body);
      if (f.channel && f.services.length > 1)
        throw new ValidationError("Choose one channel per notification toggle");
      const base = `${f.titleId}:${f.market}:${f.medium}`;
      const requested =
        !f.channel && typeof body.id === "string" && body.id ? body.id : null;
      const { title, sub } = await store.followContext(f.titleId, requested);
      if (!title) throw new ValidationError("Invalid follow preferences");
      const id = f.channel
        ? `${base}:channel:${encodeURIComponent(f.services[0] || "any")}`
        : sub &&
            sub.titleId === f.titleId &&
            sub.market === f.market &&
            sub.medium === f.medium
          ? (requested as string)
          : base;
      await store.follow({
        id,
        titleId: f.titleId,
        market: f.market,
        medium: f.medium,
        services: f.services,
        rules: f.rules,
        ...(f.channel ? { scope: "channel" } : {}),
        // Kept from the stored subscription when it already exists (done in SQL).
        createdAt: new Date().toISOString(),
      });
      return send(200, { id });
    }
    const subscriptionRoute = u.pathname.match(/^\/api\/subscriptions\/([^/]+)$/);
    if (subscriptionRoute && req.method === "DELETE") {
      await store.unfollow(decode(subscriptionRoute[1]));
      return send(200, { ok: true });
    }
    if (u.pathname === "/api/settings" && req.method === "PATCH") {
      if (
        typeof body.timezone !== "string" ||
        !body.timezone ||
        body.timezone.length > 64
      )
        throw new ValidationError("Invalid timezone");
      try {
        new Intl.DateTimeFormat("en", { timeZone: body.timezone });
      } catch {
        throw new ValidationError("Invalid timezone");
      }
      if (
        !MARKETS.includes(body.market) ||
        !Number.isInteger(body.hour) ||
        body.hour < 0 ||
        body.hour > 23
      )
        throw new ValidationError("Invalid settings");
      await store.put("settings", {
        id: "user",
        market: body.market,
        timezone: body.timezone,
        hour: body.hour,
      });
      return send(200, { ok: true });
    }
    if (u.pathname === "/api/releases" && req.method === "POST") {
      if (typeof body.titleId !== "string" || !body.titleId)
        throw new ValidationError("Invalid release fields");
      const e = releaseFrom(body, {
        id: randomUUID(),
        titleId: body.titleId,
        revision: 1,
      });
      if (!(await store.get("titles", e.titleId)))
        throw new ValidationError("Invalid release fields");
      return send(200, await store.upsert(e as any));
    }
    const releaseRoute = u.pathname.match(/^\/api\/releases\/([^/]+)$/);
    if (releaseRoute && req.method === "PATCH") {
      const id = decode(releaseRoute[1]);
      const e = await store.get("releases", id);
      if (!e) return send(404, { error: "Release not found" });
      // The title a release belongs to cannot be changed.
      const next = releaseFrom(
        { ...e, ...body },
        { id, titleId: e.titleId, revision: e.revision },
      );
      return send(200, await store.upsert(next as any));
    }
    if (u.pathname === "/api/import" && req.method === "POST") {
      if (!MARKETS.includes(body.market) || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(body.from))
        throw new ValidationError("Invalid import range");
      const d = new Date(body.from + "T12:00Z");
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      try {
        return send(200, {
          count: await importTheatrical(
            store,
            body.market,
            body.from,
            d.toISOString().slice(0, 10),
          ),
        });
      } catch (e: unknown) {
        await store
          .put("health", {
            id: "tmdb",
            state: "error",
            updatedAt: new Date().toISOString(),
            note: e instanceof HttpError ? e.message : "Import failed",
          })
          .catch((err) => console.error("Recording import health failed:", describe(err)));
        throw e;
      }
    }
    if (u.pathname === "/api/notifications/read" && req.method === "POST") {
      // { ids } marks only the notifications the client displayed; no ids marks all unread.
      let ids: string[] | undefined;
      if (body.ids !== undefined) {
        if (
          !Array.isArray(body.ids) ||
          body.ids.length > 500 ||
          body.ids.some((id: unknown) => typeof id !== "string" || !id || id.length > 500)
        )
          throw new ValidationError("Invalid notification ids");
        ids = [...new Set<string>(body.ids)]; // [] marks nothing
      }
      await store.markNotificationsRead(ids);
      return send(200, { ok: true });
    }
    return send(404, { error: "Not found" });
  } catch (e: unknown) {
    if (!initialized) {
      console.error("Lineup runtime initialisation failed:", describe(e));
      return send(503, {
        error:
          "Database unavailable. Check DATABASE_URL and apply the Supabase database migration.",
      });
    }
    if (e instanceof HttpError) {
      if (e.status >= 500)
        console.error(`API ${req.method} ${u.pathname} upstream failure:`, describe(e));
      return send(e.status, { error: e.message });
    }
    console.error(`API ${req.method} ${u.pathname} failed:`, describe(e));
    return send(503, {
      error: "Lineup is temporarily unavailable. Please try again shortly.",
    });
  }
}
