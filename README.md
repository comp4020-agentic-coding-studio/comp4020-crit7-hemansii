# ANU Library study-room booking

A single-library study-room booking system, modeled on ANU Library's real
LibCal booking site: browse rooms, see a day's schedule, book a slot, and
cancel it later. State (accounts, sessions, bookings) lives in SQLite on the
machine's volume, so it survives a reload and a redeploy, and a new booking
appears in every open tab over a server-sent-events stream.

## What good looks like here

The real system exists to stop double-booking a room and to know who booked
it — so those are the two things this prototype actually enforces, not just
displays. Booking requires signing up with an `@anu.edu.au` email and a
password: browsing rooms is public (matching the real library's public
schedule page), but only a logged-in student can hold a slot, which is the
concrete protection against one student booking a room under someone else's
email. This doesn't verify inbox ownership — no student prototype can reach
ANU's real SSO — but a password is a deliberate, real barrier where a bare
email field would have none.

Booking rules mirror the real service: a single booking can't exceed 2 hours,
a student can't hold more than 2 hours across all rooms on the same day,
rooms only open 14 days ahead, and overlapping bookings in the same room are
rejected. These are enforced server-side (`src/lib/bookings.ts`, unit-tested
in isolation from the database) — the UI's `<input type="time">` constraints
are a convenience, not the actual check.

Scoped down from the real system on purpose: one library, not four branches —
the booking rules and UI don't vary between branches, so modeling all four
would have added surface area without adding anything the crit asks to see.

What's a judgement call rather than an enforced check: room descriptions and
seed data are illustrative, not the real library's actual room list; there's
no admin view for managing rooms (out of scope for a student-facing booking
flow); and expired sessions are treated as logged-out at lookup time rather
than cleaned up, which is fine for a class prototype's lifetime.
