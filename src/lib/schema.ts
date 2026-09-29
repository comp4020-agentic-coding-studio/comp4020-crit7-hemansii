import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The schema is the ground truth for the database. To change it: edit here,
// run `pnpm db:generate` to turn the diff into a migration under drizzle/,
// and commit both — the migration applies automatically when the server
// boots (see src/lib/db.ts), locally and deployed. Never edit the database
// by hand: state on the deployed volume outlives every deploy, and the
// migration trail is what keeps old state and new code compatible.

export const users = sqliteTable("users", {
  id: int().primaryKey({ autoIncrement: true }),
  email: text().notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// The token IS the primary key — every request looks a session up by the
// cookie value it presents, so there's no reason to key it by anything else.
export const sessions = sqliteTable("sessions", {
  token: text().primaryKey(),
  userId: int("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  expiresAt: text("expires_at").notNull(),
});

export const rooms = sqliteTable("rooms", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  capacity: int().notNull(),
  // Comma-separated free text (e.g. "whiteboard,tv") rather than a separate
  // table: nothing here needs to be queried or filtered on, only displayed.
  equipment: text().notNull().default(""),
});

export const bookings = sqliteTable(
  "bookings",
  {
    id: int().primaryKey({ autoIncrement: true }),
    roomId: int("room_id")
      .notNull()
      .references(() => rooms.id),
    userId: int("user_id")
      .notNull()
      .references(() => users.id),
    // Dates and times as zero-padded text ("YYYY-MM-DD", "HH:MM"): they
    // compare correctly as plain strings, match SQLite's own date functions,
    // and drop straight into <input type="date">/<input type="time"> values
    // with no timezone conversion — this app only ever runs in one timezone.
    date: text().notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    // Null until the holder claims the room. The real library's rule is that
    // a booking is cancelled if you're more than 15 minutes late, but it's
    // only enforced by asking people to leave; storing the claim lets the app
    // enforce it directly and hand an unclaimed room back to everyone else.
    checkedInAt: text("checked_in_at"),
  },
  (t) => [index("bookings_room_date_idx").on(t.roomId, t.date)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
