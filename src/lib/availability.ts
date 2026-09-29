// Availability maths: what's free, when, and for how long. Pure and DB-free
// like src/lib/bookings.ts, so it unit-tests directly and so the room list,
// the day grid and the room page all read availability the same way rather
// than each deriving it from raw bookings on their own.

import { CLOSING_TIME, MAX_DAILY_MINUTES, OPENING_TIME } from "./bookings";

export type Interval = { startTime: string; endTime: string };

export const toMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

export const toTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const OPENING_MINUTES = toMinutes(OPENING_TIME);
export const CLOSING_MINUTES = toMinutes(CLOSING_TIME);

/** Bookings are made on the half hour, so availability is reasoned about in
    the same unit — a 10-minute gap isn't bookable and shouldn't be offered. */
export const SLOT_MINUTES = 30;

// The library sits in one timezone; the host it's deployed to might not.
// fly.toml sets TZ for the process, but naming the zone here as well means a
// missing environment variable can't silently move the whole app's idea of
// "today" onto the wrong calendar day.
export const LIBRARY_TIME_ZONE = "Australia/Sydney";

/** Wall-clock "now" in the library's own timezone, in the same string shapes
    the database and the URLs use. */
export function libraryNow(now: Date = new Date()): {
  date: string;
  time: string;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LIBRARY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const time = `${part("hour")}:${part("minute")}`;
  return { date, time, minutes: toMinutes(time) };
}

/** Bookings collapsed into non-overlapping busy runs, earliest first. Two
    bookings that merely touch (10:00–11:00 then 11:00–12:00) become one run,
    so "busy until" reports the end of the whole run rather than teasing a
    free minute that isn't there. */
export function busyRuns(booked: Interval[]): Interval[] {
  const sorted = [...booked].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const runs: { start: number; end: number }[] = [];
  for (const booking of sorted) {
    const start = toMinutes(booking.startTime);
    const end = toMinutes(booking.endTime);
    const last = runs.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else runs.push({ start, end });
  }
  return runs.map((run) => ({ startTime: toTime(run.start), endTime: toTime(run.end) }));
}

/** Open stretches with nothing booked in them, clipped to `fromMinutes` so a
    view of today never offers a slot that has already passed. */
export function freeGaps(booked: Interval[], fromMinutes: number = OPENING_MINUTES): Interval[] {
  const gaps: Interval[] = [];
  let cursor = Math.max(fromMinutes, OPENING_MINUTES);

  for (const run of busyRuns(booked)) {
    const start = Math.min(toMinutes(run.startTime), CLOSING_MINUTES);
    if (start > cursor) gaps.push({ startTime: toTime(cursor), endTime: toTime(start) });
    cursor = Math.max(cursor, toMinutes(run.endTime));
  }
  if (cursor < CLOSING_MINUTES) {
    gaps.push({ startTime: toTime(cursor), endTime: toTime(CLOSING_MINUTES) });
  }

  return gaps.filter((gap) => toMinutes(gap.endTime) - toMinutes(gap.startTime) >= SLOT_MINUTES);
}

export type RoomAvailability = {
  state: "free" | "busy" | "closed";
  /** One short line for a room card, e.g. "Free until 14:00". */
  label: string;
  /** When the room next opens up, or null if it doesn't again today. */
  nextFreeFrom: string | null;
  /** Bookable minutes left today — drives the "free now" filter and the sort. */
  freeMinutesLeft: number;
};

/** How a room stands right now, for a card in a list. */
export function roomAvailability(booked: Interval[], nowMinutes: number): RoomAvailability {
  const freeMinutesLeft = freeGaps(booked, nowMinutes).reduce(
    (total, gap) => total + toMinutes(gap.endTime) - toMinutes(gap.startTime),
    0,
  );

  if (nowMinutes >= CLOSING_MINUTES) {
    return { state: "closed", label: "Closed for today", nextFreeFrom: null, freeMinutesLeft: 0 };
  }
  if (nowMinutes < OPENING_MINUTES) {
    return { state: "closed", label: `Opens ${OPENING_TIME}`, nextFreeFrom: OPENING_TIME, freeMinutesLeft };
  }

  const runs = busyRuns(booked);
  const current = runs.find(
    (run) => toMinutes(run.startTime) <= nowMinutes && nowMinutes < toMinutes(run.endTime),
  );
  if (current) {
    return {
      state: "busy",
      label: `Busy until ${current.endTime}`,
      nextFreeFrom: toMinutes(current.endTime) < CLOSING_MINUTES ? current.endTime : null,
      freeMinutesLeft,
    };
  }

  const next = runs.find((run) => toMinutes(run.startTime) > nowMinutes);
  return {
    state: "free",
    label: `Free until ${next ? next.startTime : CLOSING_TIME}`,
    nextFreeFrom: null,
    freeMinutesLeft,
  };
}

/** Minutes a user has already committed on a date, against the daily cap. */
export function quotaUsed(bookedByUser: Interval[]): {
  usedMinutes: number;
  remainingMinutes: number;
} {
  const usedMinutes = bookedByUser.reduce(
    (total, booking) => total + toMinutes(booking.endTime) - toMinutes(booking.startTime),
    0,
  );
  return { usedMinutes, remainingMinutes: Math.max(0, MAX_DAILY_MINUTES - usedMinutes) };
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  if (hours) return `${hours}h`;
  return `${rest}m`;
}

/** How early you can claim a room, and how late you can claim it before the
    booking lapses. The real library's rule is the second number: a booking is
    cancelled if you're more than 15 minutes late. */
export const CHECK_IN_OPENS_MINUTES = 15;
export const GRACE_MINUTES = 15;

export type Claimable = Interval & { date: string; checkedInAt: string | null };

export type BookingState =
  | "upcoming"
  | "check-in-open"
  | "claimed"
  | "in-progress"
  | "released"
  | "finished";

/** A booking its holder is currently entitled to be sitting in, or about to
    be. These are the ones that can be stretched by another half hour. */
export const CURRENT_STATES: BookingState[] = ["check-in-open", "claimed", "in-progress"];

/** Where a booking sits in its own lifecycle. "released" is the one with
    consequences: an unclaimed booking stops holding the room, so it drops out
    of every availability calculation and out of the holder's daily quota. */
export function bookingState(
  booking: Claimable,
  nowDate: string,
  nowMinutes: number,
): BookingState {
  if (booking.date > nowDate) return "upcoming";
  if (booking.date < nowDate) return booking.checkedInAt ? "finished" : "released";

  const start = toMinutes(booking.startTime);
  const end = toMinutes(booking.endTime);

  if (nowMinutes >= end) return booking.checkedInAt ? "finished" : "released";
  // Checking in is allowed slightly early, so a claimed booking that hasn't
  // started yet is its own state — "upcoming" would hide the fact that the
  // check-in registered, and the room is already being held either way.
  if (booking.checkedInAt) return nowMinutes < start ? "claimed" : "in-progress";
  if (nowMinutes < start - CHECK_IN_OPENS_MINUTES) return "upcoming";
  if (nowMinutes > start + GRACE_MINUTES) return "released";
  return "check-in-open";
}

/** Whether a booking still holds its room against everyone else. */
export function holdsRoom(booking: Claimable, nowDate: string, nowMinutes: number): boolean {
  return bookingState(booking, nowDate, nowMinutes) !== "released";
}

/** The subset of bookings that still hold their room — what overlap checks,
    the timetable and the room cards should all be reasoning about. */
export function liveBookings<T extends Claimable>(
  bookings: T[],
  nowDate: string,
  nowMinutes: number,
): T[] {
  return bookings.filter((booking) => holdsRoom(booking, nowDate, nowMinutes));
}
