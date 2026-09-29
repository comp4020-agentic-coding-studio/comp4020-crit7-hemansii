import type { APIRoute } from "astro";
import { bookingState, libraryNow } from "../../../lib/availability";
import { getSessionUser } from "../../../lib/auth";
import { checkInBooking, getBooking } from "../../../lib/db";
import { bus } from "../../../lib/events";

// Claiming a room you booked. The real library's equivalent is a sign asking
// you to leave if someone else has the room; here the claim is a record, so
// an unclaimed booking can be handed back automatically instead.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = getSessionUser(cookies);
  if (!user) return redirect("/login?next=/bookings", 303);

  const form = await request.formData();
  const id = Number(form.get("id"));
  const booking = getBooking(id);
  if (!booking || booking.userId !== user.id) return redirect("/bookings?error=not-yours", 303);

  const now = libraryNow();
  if (bookingState(booking, now.date, now.minutes) !== "check-in-open") {
    return redirect("/bookings?error=checkin-window", 303);
  }

  checkInBooking(id, user.id);
  bus.emit("booking", {
    type: "updated",
    roomId: booking.roomId,
    date: booking.date,
    startTime: booking.startTime,
    endTime: booking.endTime,
  });
  return redirect("/bookings", 303);
};
