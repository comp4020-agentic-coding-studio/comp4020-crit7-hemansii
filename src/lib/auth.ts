import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { AstroCookies } from "astro";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db";
import { type User, sessions, users } from "./schema";

const scrypt = promisify(scryptCallback);

const SESSION_COOKIE = "session";
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// scrypt derives a 64-byte key from the password + a random salt; storing
// "salt:hash" means verification never needs a second lookup for the salt.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  // timingSafeEqual throws on length mismatch rather than returning false,
  // so guard it explicitly — a wrong-length stored hash must never crash.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// ANU addresses only. This doesn't verify inbox ownership — nothing a
// student prototype can reach does — but it's a deliberate, named
// simplification: a password now stands between "anyone can type your
// email" and booking as you, which is what actually matters here.
export function isAnuEmail(email: string): boolean {
  return /^[^\s@]+@anu\.edu\.au$/i.test(email);
}

export async function createSession(userId: number, cookies: AstroCookies): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
  db.insert(sessions).values({ token, userId, expiresAt }).run();
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Secure only in the deployed build: astro dev serves plain http on
    // localhost, and a Secure cookie set there wouldn't round-trip in every
    // browser. The production build runs behind Fly's https proxy.
    secure: import.meta.env.PROD,
    maxAge: SESSION_LIFETIME_MS / 1000,
  });
}

export function destroySession(cookies: AstroCookies): void {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) db.delete(sessions).where(eq(sessions.token, token)).run();
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

// A present-but-expired row is simply treated as "not logged in" — there's
// no cleanup job. For a week-long class prototype with a handful of test
// accounts, stale expired rows cost nothing to leave in place.
export function getSessionUser(cookies: AstroCookies): User | null {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const now = new Date().toISOString();
  const row = db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)))
    .get();
  return row?.user ?? null;
}
