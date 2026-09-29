import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  CLOSING_MINUTES,
  OPENING_MINUTES,
  SLOT_MINUTES,
  libraryNow,
  liveBookings,
  toTime,
} from "./availability";
import { type Booking, type Room, type User, bookings, rooms, users } from "./schema";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data), which is
// how state survives a reload and a redeploy; locally it defaults to an
// untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume — the
// recommended shape for SQLite on Fly, where there's no separate machine to
// run them from. The flow: edit src/lib/schema.ts, `pnpm db:generate`,
// commit the migration it writes to drizzle/.
migrate(db, { migrationsFolder: "./drizzle" });

// Example bookings, so nobody's first look at the app is an empty timetable.
// Dates can't live in the static seed migration (they'd be frozen at the day
// the migration was written), so this runs at boot instead.
//
// The one hard constraint: spec/booking.test.ts books relative future days 1
// to 10, always between 08:00 and 16:00, and two of its scenarios assert
// exactly which stretches of those days are free. So demo data for future
// days is confined to the evening, which the spec never books into. Today is
// unrestricted — no scenario touches day 0.
const DEMO_ACCOUNTS = [
  "a.silvestri",
  "j.wong",
  "t.okafor",
  "p.raghavan",
  "l.demarco",
  "h.nguyen",
  "m.fitzgerald",
  "c.baptiste",
].map((name) => `${name}@anu.edu.au`);

const EVENING = 17 * 60;

// Deterministic rather than random: a fixed rota reads as a plausible week and
// stays the same between restarts, so a demo doesn't reshuffle under you.
const EVENING_ROTA: Example[][] = [
  [
    { roomId: 2, start: EVENING, end: EVENING + 60 },
    { roomId: 5, start: EVENING + 120, end: EVENING + 210 },
  ],
  [
    { roomId: 4, start: EVENING + 30, end: EVENING + 120 },
    { roomId: 1, start: EVENING + 180, end: EVENING + 240 },
  ],
  [{ roomId: 6, start: EVENING + 60, end: EVENING + 150 }],
  [
    { roomId: 3, start: EVENING, end: EVENING + 90 },
    { roomId: 6, start: EVENING + 120, end: EVENING + 180 },
  ],
  [{ roomId: 5, start: EVENING + 90, end: EVENING + 180 }],
  [
    { roomId: 1, start: EVENING, end: EVENING + 60 },
    { roomId: 4, start: EVENING + 150, end: EVENING + 240 },
  ],
];

type Example = { roomId: number; start: number; end: number; checkedIn?: boolean };

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// The demo accounts persist across days, so look one up before inserting:
// users.email is unique and a second insert would throw.
const demoUser = (email: string): User =>
  db.select().from(users).where(eq(users.email, email)).get() ??
  db.insert(users).values({ email, passwordHash: "seed:not-a-real-account" }).returning().get();

/** One demo account per booking on a given day, so no seeded account is ever
    over the 2-hour daily cap its own rules would impose on a real student. */
function insertExamples(date: string, examples: Example[]): void {
  examples.forEach((example, i) => {
    if (example.start < OPENING_MINUTES || example.end > CLOSING_MINUTES) return;
    db.insert(bookings)
      .values({
        roomId: example.roomId,
        userId: demoUser(DEMO_ACCOUNTS[i % DEMO_ACCOUNTS.length]).id,
        date,
        startTime: toTime(example.start),
        endTime: toTime(example.end),
        checkedInAt: example.checkedIn ? sql`(datetime(\'now\'))` : null,
      })
      .run();
  });
}

const hasBookingsOn = (date: string): boolean =>
  db.select({ id: bookings.id }).from(bookings).where(eq(bookings.date, date)).limit(1).all()
    .length > 0;

function seedToday(now: ReturnType<typeof libraryNow>): void {
  const rows = db
    .select({
      date: bookings.date,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      checkedInAt: bookings.checkedInAt,
    })
    .from(bookings)
    .where(eq(bookings.date, now.date))
    .all();
  // A booking that lapsed unclaimed isn't holding its room any more, so it
  // doesn't count as the day being in use — the same test the rest of the app
  // applies. Without this, yesterday's demo data would suppress today's.
  if (liveBookings(rows, now.date, now.minutes).length > 0) return;

  // Anchored to whenever the app booted rather than to fixed clock times: a
  // booking seeded at 10:00 has already lapsed by lunchtime. The clamp keeps
  // every offset below inside opening hours.
  const halfHour = Math.round(now.minutes / SLOT_MINUTES) * SLOT_MINUTES;
  const anchor = Math.min(
    Math.max(halfHour, OPENING_MINUTES + 120),
    CLOSING_MINUTES - 240,
  );

  insertExamples(now.date, [
    // Running and claimed — what the room list reports as busy.
    { roomId: 4, start: anchor - 30, end: anchor + 60, checkedIn: true },
    // Butts onto the one above, so "busy until" reports the end of the run
    // rather than teasing a free half hour that isn't there.
    { roomId: 4, start: anchor + 60, end: anchor + 120 },
    { roomId: 6, start: anchor, end: anchor + 90, checkedIn: true },
    // Still to come.
    { roomId: 1, start: anchor + 30, end: anchor + 90 },
    { roomId: 5, start: anchor + 90, end: anchor + 180 },
    { roomId: 3, start: anchor + 120, end: anchor + 180 },
    // Never claimed, so it has already been handed back to everyone else and
    // room 2 reads as free.
    { roomId: 2, start: anchor - 120, end: anchor - 60 },
  ]);
}

function seedComingEvenings(today: string): void {
  EVENING_ROTA.forEach((examples, i) => {
    const date = addDays(today, i + 1);
    if (hasBookingsOn(date)) return;
    insertExamples(date, examples);
  });
}

function seedExampleBookings(): void {
  const now = libraryNow();
  seedToday(now);
  seedComingEvenings(now.date);
}
seedExampleBookings();

export type { Booking, Room, User };

export function listRooms(): Room[] {
  return db.select().from(rooms).orderBy(asc(rooms.name)).all();
}

export function getRoom(id: number): Room | undefined {
  return db.select().from(rooms).where(eq(rooms.id, id)).get();
}

export function getUserByEmail(email: string): User | undefined {
  return db.select().from(users).where(eq(users.email, email)).get();
}

export function createUser(email: string, passwordHash: string): User {
  return db.insert(users).values({ email, passwordHash }).returning().get();
}

// Everything that reasons about availability needs `date` and `checkedInAt`
// as well as the times: a booking nobody claimed stops holding its room (see
// holdsRoom in src/lib/availability.ts), and that can only be worked out with
// the day it was for and whether it was ever checked into.
export type ScheduleEntry = {
  id: number;
  roomId: number;
  userId: number;
  date: string;
  startTime: string;
  endTime: string;
  checkedInAt: string | null;
};

const scheduleColumns = {
  id: bookings.id,
  roomId: bookings.roomId,
  userId: bookings.userId,
  date: bookings.date,
  startTime: bookings.startTime,
  endTime: bookings.endTime,
  checkedInAt: bookings.checkedInAt,
};

export function listBookingsForRoomOnDate(roomId: number, date: string): ScheduleEntry[] {
  return db
    .select(scheduleColumns)
    .from(bookings)
    .where(and(eq(bookings.roomId, roomId), eq(bookings.date, date)))
    .orderBy(asc(bookings.startTime))
    .all();
}

/** Every room's bookings for one day, for the all-rooms grid and the room
    list's live status — one query rather than one per room. */
export function listBookingsOnDate(date: string): ScheduleEntry[] {
  return db
    .select(scheduleColumns)
    .from(bookings)
    .where(eq(bookings.date, date))
    .orderBy(asc(bookings.startTime))
    .all();
}

export function listBookingsForUserOnDate(userId: number, date: string): ScheduleEntry[] {
  return db
    .select(scheduleColumns)
    .from(bookings)
    .where(and(eq(bookings.userId, userId), eq(bookings.date, date)))
    .all();
}

export function listUpcomingBookingsForUser(
  userId: number,
  today: string,
): (Booking & { roomName: string })[] {
  return db
    .select({
      id: bookings.id,
      roomId: bookings.roomId,
      userId: bookings.userId,
      date: bookings.date,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      createdAt: bookings.createdAt,
      checkedInAt: bookings.checkedInAt,
      roomName: rooms.name,
    })
    .from(bookings)
    .innerJoin(rooms, eq(bookings.roomId, rooms.id))
    .where(and(eq(bookings.userId, userId), gte(bookings.date, today)))
    .orderBy(asc(bookings.date), asc(bookings.startTime))
    .all();
}

export function createBooking(params: {
  roomId: number;
  userId: number;
  date: string;
  startTime: string;
  endTime: string;
}): Booking {
  return db.insert(bookings).values(params).returning().get();
}

export function getBooking(id: number): Booking | undefined {
  return db.select().from(bookings).where(eq(bookings.id, id)).get();
}

/** Deletes the booking only if it belongs to userId. Returns whether a row was removed. */
export function cancelBooking(id: number, userId: number): boolean {
  const result = db
    .delete(bookings)
    .where(and(eq(bookings.id, id), eq(bookings.userId, userId)))
    .run();
  return result.changes > 0;
}

/** Claims a booking for its holder. Idempotent: checking in twice keeps the
    first timestamp, so a double-click can't move the record. */
export function checkInBooking(id: number, userId: number): Booking | undefined {
  return db
    .update(bookings)
    .set({ checkedInAt: sql`(datetime('now'))` })
    .where(and(eq(bookings.id, id), eq(bookings.userId, userId), isNull(bookings.checkedInAt)))
    .returning()
    .get();
}

/** Pushes a booking's end time out. The caller is responsible for checking
    the new end is free, within hours, and inside the holder's daily cap. */
export function extendBooking(id: number, userId: number, endTime: string): Booking | undefined {
  return db
    .update(bookings)
    .set({ endTime })
    .where(and(eq(bookings.id, id), eq(bookings.userId, userId)))
    .returning()
    .get();
}
