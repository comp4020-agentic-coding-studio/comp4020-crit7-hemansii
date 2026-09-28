import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, asc, eq, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
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

  const demoUser = db
    .insert(users)
    .values({ email: "demo@anu.edu.au", passwordHash: "seed:not-a-real-account" })
    .returning()
    .get();

  const today = new Date().toISOString().slice(0, 10);
  const examples = [
    { roomId: 3, startTime: "10:00", endTime: "11:30" },
    { roomId: 4, startTime: "13:00", endTime: "14:00" },
    { roomId: 5, startTime: "15:30", endTime: "17:00" },
  ];
  for (const example of examples) {
    db.insert(bookings)
      .values({ ...example, date: today, userId: demoUser.id })
      .run();
  }
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

export function listBookingsForRoomOnDate(
  roomId: number,
  date: string,
): { id: number; startTime: string; endTime: string }[] {
  return db
    .select({ id: bookings.id, startTime: bookings.startTime, endTime: bookings.endTime })
    .from(bookings)
    .where(and(eq(bookings.roomId, roomId), eq(bookings.date, date)))
    .orderBy(asc(bookings.startTime))
    .all();
}

export function listBookingsForUserOnDate(
  userId: number,
  date: string,
): { startTime: string; endTime: string }[] {
  return db
    .select({ startTime: bookings.startTime, endTime: bookings.endTime })
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
