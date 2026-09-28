import type { APIRoute } from "astro";
import { getSessionUser } from "../../../lib/auth";
import { cancelBooking, getBooking } from "../../../lib/db";
import { bus } from "../../../lib/events";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = getSessionUser(cookies);
  if (!user) return redirect("/login", 303);

  const form = await request.formData();
  const id = Number(form.get("id"));
  const booking = getBooking(id);

  if (booking && cancelBooking(id, user.id)) {
    bus.emit("booking", {
      type: "cancelled",
      roomId: booking.roomId,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
    });
  }

  return redirect("/bookings", 303);
};
