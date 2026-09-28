// Pure business rules for the booking system — no DB or Astro imports here,
// so these can be unit-tested directly with fabricated data. The API route
// does the DB reads and passes the results in.

export type BookingRejection =
  | "invalid-range"
  | "outside-hours"
  | "too-long"
  | "in-past"
  | "too-far-out"
  | "daily-cap"
  | "overlap";

export const OPENING_TIME = "08:00";
export const CLOSING_TIME = "22:00";
export const MAX_BOOKING_MINUTES = 2 * 60;
export const MAX_DAILY_MINUTES = 2 * 60;
export const MAX_DAYS_AHEAD = 14;

const toMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

const durationMinutes = (startTime: string, endTime: string): number =>
  toMinutes(endTime) - toMinutes(startTime);

const overlaps = (
  aStart: string,
  aEnd: string,
  b: { startTime: string; endTime: string },
): boolean => toMinutes(aStart) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(aEnd);

export const ERROR_MESSAGES: Record<BookingRejection, string> = {
  "invalid-range": "The end time must be after the start time.",
  "outside-hours": `Bookings run between ${OPENING_TIME} and ${CLOSING_TIME}.`,
  "too-long": "A single booking can't be longer than 2 hours.",
  "in-past": "You can't book a time that's already passed.",
  "too-far-out": `Bookings only open ${MAX_DAYS_AHEAD} days ahead.`,
  "daily-cap": "You've already got 2 hours booked that day.",
  overlap: "That room is already booked for part of this time.",
};

export function validateBooking(params: {
  date: string;
  startTime: string;
  endTime: string;
  existingForRoom: { startTime: string; endTime: string }[];
  existingForUserToday: { startTime: string; endTime: string }[];
  now: Date;
}): BookingRejection | null {
  const { date, startTime, endTime, existingForRoom, existingForUserToday, now } = params;

  if (toMinutes(endTime) <= toMinutes(startTime)) return "invalid-range";
  if (toMinutes(startTime) < toMinutes(OPENING_TIME) || toMinutes(endTime) > toMinutes(CLOSING_TIME)) {
    return "outside-hours";
  }
  if (durationMinutes(startTime, endTime) > MAX_BOOKING_MINUTES) return "too-long";

  const start = new Date(`${date}T${startTime}:00`);
  if (start.getTime() < now.getTime()) return "in-past";

  const daysAhead = Math.ceil((start.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (daysAhead > MAX_DAYS_AHEAD) return "too-far-out";

  const bookedToday = existingForUserToday.reduce(
    (total, b) => total + durationMinutes(b.startTime, b.endTime),
    0,
  );
  if (bookedToday + durationMinutes(startTime, endTime) > MAX_DAILY_MINUTES) return "daily-cap";

  if (existingForRoom.some((b) => overlaps(startTime, endTime, b))) return "overlap";

  return null;
}
