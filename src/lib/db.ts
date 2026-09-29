import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { CLOSING_MINUTES, OPENING_MINUTES, SLOT_MINUTES, libraryNow, toTime } from "./availability";
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

// A handful of example bookings so a fresh database (a first boot, or a
// throwaway one under test) doesn't demo as a totally empty timetable. Dates
// can't live in the static seed migration (they'd be frozen at the day the
// migration was written), so this runs at boot instead, guarded to fire only
// once — before any real booking exists. It seeds "today", which none of the
// booking spec's scenarios touch (they all book relative future days), so it
// never collides with a test run.
function seedExampleBookings(): void {
  if (db.select({ id: bookings.id }).from(bookings).limit(1).all().length > 0) return;

  const now = libraryNow();
  const today = now.date;

  // Anchor the examples to whenever the app first booted rather than to fixed
  // clock times: a booking seeded at 10:00 has already lapsed by lunchtime,
  // which would leave a first look at the app showing an empty day. Backing
  // off the closing time keeps the later examples inside opening hours.
  const halfHour = Math.round(now.minutes / SLOT_MINUTES) * SLOT_MINUTES;
  const anchor = Math.min(Math.max(halfHour, OPENING_MINUTES + 60), CLOSING_MINUTES - 240);

  const examples = [
    // Running now and claimed — the state the room list reports as busy.
    { roomId: 4, start: anchor - 30, end: anchor + 60, checkedIn: true },
    // Still to come.
    { roomId: 5, start: anchor + 90, end: anchor + 180, checkedIn: false },
    { roomId: 3, start: anchor + 120, end: anchor + 180, checkedIn: false },
    // Never claimed, so it has already been handed back to everyone else.
    { roomId: 2, start: anchor - 120, end: anchor - 60, checkedIn: false },
  ];

  examples.forEach((example, i) => {
    if (example.start < OPENING_MINUTES || example.end > CLOSING_MINUTES) return;
    const user = db
      .insert(users)
      .values({ email: `demo${i + 1}@anu.edu.au`, passwordHash: "seed:not-a-real-account" })
      .returning()
      .get();
    db.insert(bookings)
      .values({
        roomId: example.roomId,
        userId: user.id,
        date: today,
        startTime: toTime(example.start),
        endTime: toTime(example.end),
        checkedInAt: example.checkedIn ? sql`(datetime('now'))` : null,
      })
      .run();
  });
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
