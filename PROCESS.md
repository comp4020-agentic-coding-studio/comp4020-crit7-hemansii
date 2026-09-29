# Process overview

## What I built

A study-room booking system for ANU Library that leads with live availability
instead of making you check rooms one at a time. `README.md` says what it is;
this is how I got there.

## How I got here

I replaced the starter's guestbook with the booking domain in one pass — schema,
`@anu.edu.au` auth, the booking rules as a pure function, and a spec driving
them over HTTP
([`674bf3a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-hemansii/commit/674bf3a)).
Then five commits iterating on how it looked
([`4ac2866...4b1580a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-hemansii/compare/4ac2866...4b1580a)),
each one me pushing back on something specific.

The turn came when I stopped asking for it to look better and asked what it
should do:

> refer to how the already exisiting anu library room booking system works,
> come up with new and helpful features

Researching the real LibCal site surfaced three things I hadn't known:
availability sits entirely behind SSO, rooms are siloed across four branch grids
with no view between them, and a booking is managed only through the email that
confirmed it. That reframed the work from prettier to answering the question the
real one can't, and the features fell out of it — public browsing, an all-rooms
day grid, click-to-book, and check-in enforcing the 15-minute lapse rule the
real library only prints on a sign
([`c89fe97`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-hemansii/commit/c89fe97)).

Two bugs no test caught: a UTC container put "today" on the wrong day, and
checking in early silently blocked extending. Both were about *when*, so the
availability logic moved into a pure state machine unit-tested against a fixed
clock — 57 tests to 101.

I also assumed the agent could see the deployed page. It can't. Once that was
explicit, I described what looked wrong and it verified the fix reached the
page.
