import type { APIRoute } from "astro";
import { getSessionUser } from "../../../lib/auth";
import { validateBooking } from "../../../lib/bookings";
import { createBooking, listBookingsForRoomOnDate, listBookingsForUserOnDate } from "../../../lib/db";
import { bus } from "../../../lib/events";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = getSessionUser(cookies);
  const form = await request.formData();
  const roomId = Number(form.get("roomId"));
  const date = String(form.get("date") ?? "");
  const startTime = String(form.get("startTime") ?? "");
  const endTime = String(form.get("endTime") ?? "");
  const back = `/rooms/${roomId}/?date=${date}`;

  if (!user) return redirect(`/login?next=${encodeURIComponent(back)}`, 303);

  const rejection = validateBooking({
    date,
    startTime,
    endTime,
    existingForRoom: listBookingsForRoomOnDate(roomId, date),
    existingForUserToday: listBookingsForUserOnDate(user.id, date),
    now: new Date(),
  });
  if (rejection) return redirect(`${back}&error=${rejection}`, 303);

  createBooking({ roomId, userId: user.id, date, startTime, endTime });
  bus.emit("booking", { type: "created", roomId, date, startTime, endTime });
  return redirect(back, 303);
};
