import { randomUUID, timingSafeEqual } from "node:crypto";
import { emailConfigured } from "../email";
import { getRuntime } from "./runtime";
import {
  searchTMDB,
  importTheatrical,
  hydrateTitle,
  hydrateSeason,
} from "../providers";

export async function handleApi(request: Request) {
  let initialized = false;
  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  const req = {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    socket: { remoteAddress: "personal-owner" },
  };
  const res = {
    setHeader: (key: string, value: string) => responseHeaders.set(key, value),
  };
  const send = (status: number, data: unknown) =>
    Response.json(data, { status, headers: responseHeaders });
  const u = new URL(request.url);
  async function validateRelease(e: any) {
    const { store } = await getRuntime();
    if (
      !(await store.get("titles", e.titleId)) ||
      !["US", "GB", "LK"].includes(e.market) ||
      !["theatrical", "streaming"].includes(e.medium) ||
      !["day", "month", "quarter", "year", "unknown"].includes(e.precision) ||
      ![
        "announced",
        "estimated",
        "postponed",
        "cancelled",
        "first_observed",
      ].includes(e.status)
    )
      throw Error("Invalid release fields");
    if (e.precision === "unknown") e.date = null;
    else if (
      !/^\d{4}-\d{2}-\d{2}$/.test(e.date) ||
      new Date(e.date + "T12:00Z").toISOString().slice(0, 10) !== e.date
    )
      throw Error("Enter a valid date");
    if (!e.source?.trim()) throw Error("A source note is required");
    if (e.sourceUrl && !/^https?:\/\//.test(e.sourceUrl))
      throw Error("Source must be an HTTP URL");
    if (e.medium === "streaming" && e.offer !== "subscription")
      throw Error("Only subscription premieres are supported");
    return e;
  }
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
      body = JSON.parse(raw || "{}");
    }
    const signedIn = await auth.authenticated(req);
    if (u.pathname === "/api/auth/status" && req.method === "GET")
      return send(200, {
        setupRequired: !(await auth.user()),
        setupKeyRequired: !!process.env.SETUP_KEY,
        authenticated: signedIn,
        user: signedIn ? await auth.user() : null,
      });
    const address = req.socket.remoteAddress || "local";
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
      await store.tick();
      return send(200, {
        titles: await store.all("titles"),
        releases: await store.all("releases"),
        subscriptions: await store.all("subscriptions"),
        settings: await store.get("settings", "user"),
        notifications: await store.all("notifications"),
        health: await store.all("health"),
        sources: {
          tmdb: !!process.env.TMDB_TOKEN,
          streaming: false,
          email: !!process.env.DATABASE_URL && emailConfigured(),
        },
      });
    }
    if (u.pathname === "/api/search" && req.method === "GET") {
      const q = (u.searchParams.get("q") || "").slice(0, 200);
      if (!q.trim()) return send(200, []);
      if (process.env.TMDB_TOKEN) {
        const rows = await searchTMDB(q);
        for (const t of rows) await store.put("titles", t);
        return send(200, rows);
      }
      return send(
        200,
        (await store.all("titles")).filter((t) =>
          t.name.toLowerCase().includes(q.toLowerCase()),
        ),
      );
    }
    const titleRoute = u.pathname.match(
      /^\/api\/titles\/([^/]+)(?:\/seasons\/(\d+))?$/,
    );
    if (titleRoute && req.method === "GET") {
      const title = await store.get(
        "titles",
        decodeURIComponent(titleRoute[1]),
      );
      if (!title) return send(404, { error: "Title not found" });
      if (!process.env.TMDB_TOKEN || !title.tmdbId) return send(200, title);
      const season = titleRoute[2] ? Number(titleRoute[2]) : null;
      if (season !== null && (season < 1 || season > 100))
        throw Error("Invalid season");
      const hydrated =
        season !== null
          ? await hydrateSeason(title, season)
          : await hydrateTitle(title);
      await store.put("titles", hydrated);
      return send(200, hydrated);
    }
    if (u.pathname === "/api/subscriptions" && req.method === "POST") {
      if (
        !(await store.get("titles", body.titleId)) ||
        !["US", "GB", "LK"].includes(body.market) ||
        !["theatrical", "streaming"].includes(body.medium) ||
        !Array.isArray(body.services) ||
        body.services.some((s: any) => typeof s !== "string") ||
        !Array.isArray(body.rules) ||
        body.rules.some(
          (r: any) =>
            !["announced", "changed", "week", "day", "release"].includes(r),
        )
      )
        return send(400, { error: "Invalid follow preferences" });
      if (body.scope === "channel" && body.services.length > 1)
        return send(400, {
          error: "Choose one channel per notification toggle",
        });
      const base = `${body.titleId}:${body.market}:${body.medium}`;
      const id =
        body.scope === "channel"
          ? `${base}:channel:${encodeURIComponent(body.services[0] || "any")}`
          : body.id &&
              (await store.get("subscriptions", body.id))?.titleId ===
                body.titleId &&
              (await store.get("subscriptions", body.id))?.market ===
                body.market &&
              (await store.get("subscriptions", body.id))?.medium ===
                body.medium
            ? body.id
            : base;
      await store.put("subscriptions", {
        ...body,
        id,
        createdAt:
          (await store.get("subscriptions", id))?.createdAt ||
          new Date().toISOString(),
      });
      return send(200, { id });
    }
    if (
      u.pathname.startsWith("/api/subscriptions/") &&
      req.method === "DELETE"
    ) {
      await store.unfollow(decodeURIComponent(u.pathname.slice(19)));
      return send(200, { ok: true });
    }
    if (u.pathname === "/api/settings" && req.method === "PATCH") {
      try {
        new Intl.DateTimeFormat("en", { timeZone: body.timezone });
      } catch {
        throw Error("Invalid timezone");
      }
      if (
        !["US", "GB", "LK"].includes(body.market) ||
        !Number.isInteger(body.hour) ||
        body.hour < 0 ||
        body.hour > 23
      )
        throw Error("Invalid settings");
      await store.put("settings", {
        id: "user",
        market: body.market,
        timezone: body.timezone,
        hour: body.hour,
      });
      return send(200, { ok: true });
    }
    if (u.pathname === "/api/releases" && req.method === "POST") {
      const e = await validateRelease({
        ...body,
        id: randomUUID(),
        revision: 1,
        manual: true,
      });
      return send(200, await store.upsert(e));
    }
    if (u.pathname.startsWith("/api/releases/") && req.method === "PATCH") {
      const id = u.pathname.split("/").pop()!;
      const e = await store.get("releases", id);
      if (!e) return send(404, { error: "Release not found" });
      return send(
        200,
        await store.upsert(
          await validateRelease({ ...e, ...body, id, manual: true }),
        ),
      );
    }
    if (u.pathname === "/api/import" && req.method === "POST") {
      if (
        !["US", "GB", "LK"].includes(body.market) ||
        !/^\d{4}-\d{2}-01$/.test(body.from)
      )
        throw Error("Invalid import range");
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
      } catch (e: any) {
        await store.put("health", {
          id: "tmdb",
          state: "error",
          updatedAt: new Date().toISOString(),
          note: e.message,
        });
        throw e;
      }
    }
    if (u.pathname === "/api/notifications/read" && req.method === "POST") {
      for (const n of await store.all("notifications"))
        await store.put("notifications", { ...n, read: true });
      return send(200, { ok: true });
    }
    return send(404, { error: "Not found" });
  } catch (e: unknown) {
    return send(initialized ? 400 : 503, {
      error: !initialized
        ? "Database unavailable. Check DATABASE_URL and apply the Supabase database migration."
        : e instanceof Error
          ? e.message
          : "Request failed",
    });
  }
}
