# ANU Library study-room booking

A single-library study-room booking system, answering the question the real
one can't: **where can I sit right now?** Live availability for every room on
one page, a whole day's grid across all rooms, booking in two clicks, and
self-service check-in that hands an unclaimed room back to everyone else.
State (accounts, sessions, bookings) lives in SQLite on the machine's volume,
so it survives a reload and a redeploy, and a booking appears in every open
tab over a server-sent-events stream.

## What good looks like here

The real system exists to stop double-booking a room and to know who booked
it — so those are the two things this prototype actually enforces, not just
displays. Booking requires signing up with an `@anu.edu.au` email and a
password: browsing rooms is public, but only a logged-in student can hold a
slot, which is the concrete protection against one student booking a room
under someone else's email. This doesn't verify inbox ownership — no student
prototype can reach ANU's real SSO — but a password is a deliberate, real
barrier where a bare email field would have none.

Booking rules mirror the real service: a student can't hold more than 2 hours
across all rooms on the same day, no single booking exceeds 2 hours, rooms
only open 14 days ahead, and overlapping bookings in the same room are
rejected. These are enforced server-side (`src/lib/bookings.ts`, unit-tested
in isolation from the database) — the pickers in the UI are a convenience, not
the actual check.

## What this does that the real one doesn't

Three things about ANU's LibCal site shaped this build:

| On the real site | Here |
| --- | --- |
| Every availability grid sits behind SSO, so you can't tell whether it's worth walking over | Room list, day grid and every room's schedule are public; a session is only needed to *hold* a slot |
| Rooms are siloed across four branch grids with no view between them | `/` ranks every room by live status, filtered by group size, equipment and "free right now" |
| Finding a slot means reading one room's grid at a time | `/schedule` puts every room's whole day on one grid, and each free stretch is a link that opens the booking dialog pre-filled |
| A booking is managed only through the email that confirmed it — lose it and you email a human | `/bookings` carries the whole lifecycle: check in, extend by 30 minutes, or cancel |

Check-in is the one new *rule*, not just new UI. The real library's policy is
that a booking is cancelled if you're more than 15 minutes late, but it's
enforced by a sign asking people to leave. Storing the claim lets the app
enforce it: a booking nobody checks into stops holding its room, drops out of
every availability view, and stops counting against the holder's daily cap —
so an unattended booking gives the room back instead of blocking it. The
lifecycle is a pure state machine (`src/lib/availability.ts`) unit-tested
against a fixed clock, because the interesting cases are all about *when*.

## Scope and judgement calls

Scoped down on purpose: one library, not four branches — the booking rules
don't vary between branches, so modeling all four would add surface area
without adding anything the crit asks to see. Real ANU also runs different
rules per space type and forbids back-to-back bookings; both are scarcity
workarounds rather than things worth reproducing in a system you'd rather
have.

Times are wall-clock strings for a single timezone, and the app pins that
timezone explicitly (`Australia/Sydney`) rather than trusting the host's — a
UTC container would otherwise put "today" on the wrong calendar day for most
of the Canberra working day.

What's a judgement call rather than an enforced check: room names and seed
data are illustrative, not the real library's room list; there's no admin view
for managing rooms (out of scope for a student-facing flow); and expired
sessions are treated as logged-out at lookup time rather than cleaned up,
which is fine for a class prototype's lifetime.
