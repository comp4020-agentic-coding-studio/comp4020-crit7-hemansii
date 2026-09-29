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
Then five commits improving the design — spacing, colours, layout, accessibility
([`4ac2866...4b1580a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-hemansii/compare/4ac2866...4b1580a)),
each one me pushing back on something specific.

What changed the work was realising the bigger issue was not just how the site
looked, but how useful the booking process actually was for students. From
using the real ANU system I already had a few ideas about what felt
inconvenient, especially not being able to quickly see which rooms were
available, so I used the agent to check the existing system more closely:

> refer to how the already exisiting anu library room booking system works,
> come up with new and helpful features

It confirmed some of those issues and turned up ones I hadn't seen — rooms
split across four separate branch pages, and a booking you can only manage
through the confirmation email. I came up with feature ideas around those
problems and chose what to build: making room availability easier to see, an
all-rooms day grid, click-to-book, and check-in enforcing the 15-minute lapse
rule the real library only prints on a sign
([`c89fe97`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-hemansii/commit/c89fe97)).

Two bugs no test caught: a UTC container put "today" on the wrong day, and
checking in early silently blocked extending. Both were about *when*, so the
availability logic moved into a pure state machine unit-tested against a fixed
clock — 57 tests to 101.
