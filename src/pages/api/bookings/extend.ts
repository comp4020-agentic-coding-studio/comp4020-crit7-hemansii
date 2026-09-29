import type { APIRoute } from "astro";
import {
  CLOSING_MINUTES,
  CURRENT_STATES,
  SLOT_MINUTES,
  bookingState,
  libraryNow,
  liveBookings,
  quotaUsed,
  toMinutes,
  toTime,
} from "../../../lib/availability";
import { getSessionUser } from "../../../lib/auth";
import {
  extendBooking,
  getBooking,
  listBookingsForRoomOnDate,
  listBookingsForUserOnDate,
} from "../../../lib/db";
import { bus } from "../../../lib/events";

// Adding half an hour to a booking that's already running. The real library
// allows this "if the room is available", but only as a request made near the
// end of your slot; the same three things have to be true here, and all three
// are checked server-side.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = getSessionUser(cookies);
  if (!user) return redirect("/login?next=/bookings", 303);

  const form = await request.formData();
  const id = Number(form.get("id"));
  const booking = getBooking(id);
  if (!booking || booking.userId !== user.id) return redirect("/bookings?error=not-yours", 303);

  const now = libraryNow();
  if (!CURRENT_STATES.includes(bookingState(booking, now.date, now.minutes))) {
    return redirect("/bookings?error=extend-window", 303);
  }

  const newEnd = toMinutes(booking.endTime) + SLOT_MINUTES;
  if (newEnd > CLOSING_MINUTES) return redirect("/bookings?error=extend-hours", 303);

  const others = liveBookings(
    listBookingsForRoomOnDate(booking.roomId, booking.date),
    now.date,
    now.minutes,
  ).filter((other) => other.id !== booking.id);
  const clashes = others.some(
    (other) => toMinutes(other.startTime) < newEnd && toMinutes(booking.endTime) < toMinutes(other.endTime),
  );
  if (clashes) return redirect("/bookings?error=extend-taken", 303);

  const mine = liveBookings(
    listBookingsForUserOnDate(user.id, booking.date),
    now.date,
    now.minutes,
  );
  if (quotaUsed(mine).remainingMinutes < SLOT_MINUTES) {
    return redirect("/bookings?error=extend-cap", 303);
  }

  extendBooking(id, user.id, toTime(newEnd));
  bus.emit("booking", {
    type: "updated",
    roomId: booking.roomId,
    date: booking.date,
    startTime: booking.startTime,
    endTime: toTime(newEnd),
  });
  return redirect("/bookings", 303);
};
