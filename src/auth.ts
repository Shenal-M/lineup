import {
  randomBytes,
  scrypt as derive,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(derive);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const lifespan = 30 * 24 * 60 * 60 * 1000;
export function createAuth(db: any) {
  const initialized = Promise.resolve(
    db.exec(
      `CREATE TABLE IF NOT EXISTS account(id TEXT PRIMARY KEY,email TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS auth_attempts(address TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);`,
    ),
  );
  const owner = async () => {
    await initialized;
    return await db.prepare("SELECT * FROM account WHERE id='owner'").get();
  };
  const user = async () => {
    const a = await owner();
    return a ? { email: a.email } : null;
  };
  const cookie = (req: any) => {
    const v = (req.headers.cookie || "")
      .split(";")
      .map((x: string) => x.trim())
      .find((x: string) => x.startsWith("lineup_session="));
    return v ? v.slice(15) : "";
  };
  const authenticated = async (req: any) => {
    const token = cookie(req);
    if (!/^[a-f0-9]{64}$/.test(token)) return false;
    const row = await db
      .prepare("SELECT expires FROM sessions WHERE id=?")
      .get(hash(token));
    return !!row && row.expires > Date.now();
  };
  const setCookie = (res: any, value: string, maxAge: number) =>
    res.setHeader(
      "Set-Cookie",
      `lineup_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.COOKIE_SECURE === "true" || process.env.VERCEL ? "; Secure" : ""}`,
    );
  const login = async (res: any) => {
    await db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    await db
      .prepare("INSERT INTO sessions VALUES(?,?)")
      .run(hash(token), Date.now() + lifespan);
    setCookie(res, token, lifespan / 1000);
  };
  const allowed = async (address: string) => {
    const r = await db
      .prepare("SELECT * FROM auth_attempts WHERE address=?")
      .get(address);
    return !r || r.reset_at <= Date.now() || r.count < 10;
  };
  const fail = async (address: string) => {
    const r = await db
      .prepare("SELECT * FROM auth_attempts WHERE address=?")
      .get(address);
    if (!r || r.reset_at <= Date.now())
      await db
        .prepare("INSERT OR REPLACE INTO auth_attempts VALUES(?,1,?)")
        .run(address, Date.now() + 15 * 60 * 1000);
    else
      await db
        .prepare("UPDATE auth_attempts SET count=count+1 WHERE address=?")
        .run(address);
  };
  async function verify(password: string) {
    const a = await owner();
    const derived = (await scrypt(
      password,
      a?.salt || "lineup-timing-salt",
      64,
    )) as Buffer;
    return !!a && timingSafeEqual(derived, Buffer.from(a.password_hash, "hex"));
  }
  async function setup(email: string, password: string, res: any) {
    if (await owner())
      throw Error("This personal Lineup already has an owner. Please sign in.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      throw Error("Enter a valid email address.");
    if (password.length < 12 || password.length > 256)
      throw Error("Choose a password between 12 and 256 characters.");
    const salt = randomBytes(32).toString("hex");
    const key = (await scrypt(password, salt, 64)) as Buffer;
    await db
      .prepare("INSERT INTO account VALUES(?,?,?,?)")
      .run("owner", email.toLowerCase(), salt, key.toString("hex"));
    await login(res);
    return user();
  }
  async function signIn(
    email: string,
    password: string,
    address: string,
    res: any,
  ) {
    if (!(await allowed(address)))
      return {
        status: 429,
        error: "Too many attempts. Try again in 15 minutes.",
      };
    const valid = await verify(password);
    const a = await owner();
    if (!valid || a.email !== email.toLowerCase()) {
      await fail(address);
      return { status: 401, error: "Email or password is incorrect." };
    }
    await db.prepare("DELETE FROM auth_attempts WHERE address=?").run(address);
    await login(res);
    return { status: 200, user: await user() };
  }
  async function changePassword(
    current: string,
    next: string,
    address: string,
    res: any,
  ) {
    if (!(await allowed(address)))
      throw Error("Too many attempts. Try again in 15 minutes.");
    if (!(await verify(current))) {
      await fail(address);
      throw Error("Current password is incorrect.");
    }
    if (next.length < 12 || next.length > 256)
      throw Error("Choose a password between 12 and 256 characters.");
    const salt = randomBytes(32).toString("hex");
    const key = (await scrypt(next, salt, 64)) as Buffer;
    if (db.changeCredentials)
      await db.changeCredentials(salt, key.toString("hex"));
    else {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "UPDATE account SET salt=?,password_hash=? WHERE id='owner'",
        ).run(salt, key.toString("hex"));
        db.exec("DELETE FROM sessions");
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
    await db.prepare("DELETE FROM auth_attempts WHERE address=?").run(address);
    await login(res);
  }
  async function logout(req: any, res: any) {
    await db.prepare("DELETE FROM sessions WHERE id=?").run(hash(cookie(req)));
    setCookie(res, "", 0);
  }
  return { user, authenticated, setup, signIn, changePassword, logout };
}
