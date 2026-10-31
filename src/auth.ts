import {
  randomBytes,
  scrypt as derive,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { HttpError, ValidationError } from "./model.ts";
import type { Store } from "./postgres-store.ts";
const scrypt = promisify(derive);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const lifespan = 30 * 24 * 60 * 60 * 1000;
const WINDOW = 15 * 60 * 1000;
// Per-address attempts per window are a hard limit. Past a looser cap across all
// addresses, every attempt is slowed instead of refused, so rotating addresses cannot
// brute force the owner account quickly but also cannot lock the owner out.
const PER_ADDRESS = 10;
const GLOBAL = 50;
const GLOBAL_DELAY_MS = 2000;
// Verified sessions are re-checked against the database at most once a minute per instance.
const SESSION_CACHE_MS = 60 * 1000;
const TOO_MANY = "Too many attempts. Try again in 15 minutes.";

// Client address for rate limiting: the first x-forwarded-for entry (set by the hosting
// proxy) or x-real-ip, otherwise a shared constant.
export function clientAddress(headers: Record<string, string | undefined>) {
  const forwarded = (headers["x-forwarded-for"] || "").split(",")[0].trim();
  const address = forwarded || (headers["x-real-ip"] || "").trim();
  return address ? address.slice(0, 100) : "unknown";
}

// Tables are created by supabase/migrations, not at runtime.
export function createAuth(db: Store["db"]) {
  const { sql } = db;
  const sessions = new Map<string, { expires: number; checked: number }>();
  const owner = async () =>
    (await sql`select email, salt, password_hash from account where id='owner'`)[0];
  const user = async () => {
    const a = await owner();
    return a ? { email: a.email as string } : null;
  };
  const cookie = (req: any) => {
    const v = (req.headers.cookie || "")
      .split(";")
      .map((x: string) => x.trim())
      .find((x: string) => x.startsWith("lineup_session="));
    return v ? v.slice(15) : "";
  };
  const remember = (id: string, expires: number) => {
    if (sessions.size >= 1000) sessions.clear();
    sessions.set(id, { expires, checked: Date.now() });
  };
  const authenticated = async (req: any) => {
    const token = cookie(req);
    if (!/^[a-f0-9]{64}$/.test(token)) return false;
    const id = hash(token);
    const now = Date.now();
    const cached = sessions.get(id);
    if (cached && now - cached.checked < SESSION_CACHE_MS) return cached.expires > now;
    const [row] = await sql`select expires from sessions where id=${id}`;
    const expires = row ? Number(row.expires) : 0;
    if (expires > now) remember(id, expires);
    else sessions.delete(id);
    return expires > now;
  };
  const setCookie = (res: any, value: string, maxAge: number) =>
    res.setHeader(
      "Set-Cookie",
      `lineup_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.COOKIE_SECURE === "true" || process.env.VERCEL ? "; Secure" : ""}`,
    );
  // Creates a session (purging expired ones). After a successful password check it also
  // frees the address's attempt slots and gives back its global slot, in the same statement.
  const login = async (res: any, address?: string) => {
    const token = randomBytes(32).toString("hex");
    const id = hash(token);
    const now = Date.now();
    const key = address === undefined ? null : "ip:" + address;
    await sql`with expired as (delete from sessions where expires<=${now}),
      freed as (delete from auth_attempts where ${key}::text is not null and address=${key}::text),
      returned as (update auth_attempts set count=greatest(count-1,0) where ${key}::text is not null and address='global')
      insert into sessions(id,expires) values(${id},${now + lifespan})`;
    remember(id, now + lifespan);
    setCookie(res, token, lifespan / 1000);
  };
  // Atomically takes an attempt slot (per address and global) before any password work,
  // and reads the owner in the same statement. Returns null when over the address limit;
  // over the global cap the attempt is delayed.
  const take = async (address: string) => {
    const now = Date.now();
    const [row] = await sql`
      with slots as (
        insert into auth_attempts(address,count,reset_at)
        values(${"ip:" + address},1,${now + WINDOW}),('global',1,${now + WINDOW})
        on conflict(address) do update set
          count=case when auth_attempts.reset_at<=${now} then 1 else auth_attempts.count+1 end,
          reset_at=case when auth_attempts.reset_at<=${now} then excluded.reset_at else auth_attempts.reset_at end
        returning address, count)
      select
        (select bool_and(count <= ${PER_ADDRESS}::int) from slots where address<>'global') as allowed,
        (select bool_and(count <= ${GLOBAL}::int) from slots where address='global') as unhurried,
        a.email, a.salt, a.password_hash
      from (select 1) x left join account a on a.id='owner'`;
    if (!row.allowed) return null;
    if (!row.unhurried)
      await new Promise((resolve) => setTimeout(resolve, GLOBAL_DELAY_MS));
    return { owner: row.email ? row : null };
  };
  async function verify(a: any, password: string) {
    const derived = (await scrypt(
      password,
      a?.salt || "lineup-timing-salt",
      64,
    )) as Buffer;
    return !!a && timingSafeEqual(derived, Buffer.from(a.password_hash, "hex"));
  }
  async function setup(email: string, password: string, res: any) {
    const exists = new ValidationError(
      "This personal Lineup already has an owner. Please sign in.",
    );
    if (await owner()) throw exists;
    if (!/^[^\s@\0]+@[^\s@\0]+\.[^\s@\0]+$/.test(email) || email.length > 254)
      throw new ValidationError("Enter a valid email address.");
    if (password.length < 12 || password.length > 256)
      throw new ValidationError("Choose a password between 12 and 256 characters.");
    const salt = randomBytes(32).toString("hex");
    const key = (await scrypt(password, salt, 64)) as Buffer;
    const created =
      await sql`insert into account(id,email,salt,password_hash) values('owner',${email.toLowerCase()},${salt},${key.toString("hex")}) on conflict(id) do nothing returning id`;
    if (!created.length) throw exists;
    await login(res);
    return { email: email.toLowerCase() };
  }
  async function signIn(
    email: string,
    password: string,
    address: string,
    res: any,
  ) {
    const slot = await take(address);
    if (!slot) return { status: 429, error: TOO_MANY };
    const a = slot.owner;
    const valid = await verify(a, password);
    if (!valid || !a || a.email !== email.toLowerCase())
      return { status: 401, error: "Email or password is incorrect." };
    await login(res, address);
    return { status: 200, user: { email: a.email as string } };
  }
  async function changePassword(
    current: string,
    next: string,
    address: string,
    res: any,
  ) {
    const slot = await take(address);
    if (!slot) throw new HttpError(TOO_MANY, 429);
    if (!(await verify(slot.owner, current)))
      throw new ValidationError("Current password is incorrect.");
    if (next.length < 12 || next.length > 256)
      throw new ValidationError("Choose a password between 12 and 256 characters.");
    const salt = randomBytes(32).toString("hex");
    const key = (await scrypt(next, salt, 64)) as Buffer;
    await db.changeCredentials(salt, key.toString("hex"));
    sessions.clear();
    await login(res, address);
  }
  async function logout(req: any, res: any) {
    const id = hash(cookie(req));
    sessions.delete(id);
    await sql`delete from sessions where id=${id}`;
    setCookie(res, "", 0);
  }
  return { user, authenticated, setup, signIn, changePassword, logout };
}
