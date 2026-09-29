import { describe, expect, it } from "vitest";
import {
  bookingState,
  busyRuns,
  formatDuration,
  freeGaps,
  libraryNow,
  liveBookings,
  quotaUsed,
  roomAvailability,
} from "../src/lib/availability";

// src/lib/availability.ts is what turns raw bookings into the answers the UI
// actually shows ("Free until 14:00", the clickable gaps in the timetable,
// how much of your daily cap is left). It's pure, so these drive it directly
// rather than over HTTP.

const at = (startTime: string, endTime: string) => ({ startTime, endTime });

describe("busyRuns", () => {
  it("merges bookings that touch into one run", () => {
    expect(busyRuns([at("10:00", "11:00"), at("11:00", "12:00")])).toEqual([at("10:00", "12:00")]);
  });

  it("keeps bookings with a real gap between them separate", () => {
    expect(busyRuns([at("10:00", "11:00"), at("13:00", "14:00")])).toEqual([
      at("10:00", "11:00"),
      at("13:00", "14:00"),
    ]);
  });

  it("sorts runs even when the bookings arrive out of order", () => {
    expect(busyRuns([at("15:00", "16:00"), at("09:00", "10:00")])).toEqual([
      at("09:00", "10:00"),
      at("15:00", "16:00"),
    ]);
  });
});

describe("freeGaps", () => {
  it("returns the whole open day when nothing is booked", () => {
    expect(freeGaps([])).toEqual([at("08:00", "22:00")]);
  });

  it("splits the day around a booking", () => {
    expect(freeGaps([at("10:00", "11:30")])).toEqual([at("08:00", "10:00"), at("11:30", "22:00")]);
  });

  it("clips gaps that have already passed", () => {
    // 13:00 now: the morning is gone, and the gap before the 15:00 booking
    // starts from now rather than from opening.
    expect(freeGaps([at("15:00", "16:00")], 13 * 60)).toEqual([
      at("13:00", "15:00"),
      at("16:00", "22:00"),
    ]);
  });

  it("drops stretches too short to book", () => {
    // A 15-minute sliver between two bookings isn't offerable on a 30-minute
    // grid, so it shouldn't appear as a gap at all.
    expect(freeGaps([at("10:00", "10:45"), at("11:00", "12:00")])).toEqual([
      at("08:00", "10:00"),
      at("12:00", "22:00"),
    ]);
  });

  it("returns nothing once the library has closed", () => {
    expect(freeGaps([], 22 * 60)).toEqual([]);
  });
});

describe("roomAvailability", () => {
  it("reports a free room and when its next booking starts", () => {
    const status = roomAvailability([at("15:00", "16:00")], 13 * 60);
    expect(status.state).toBe("free");
    expect(status.label).toBe("Free until 15:00");
  });

  it("reports a busy room and when it frees up", () => {
    const status = roomAvailability([at("13:00", "14:30")], 13 * 60 + 30);
    expect(status.state).toBe("busy");
    expect(status.label).toBe("Busy until 14:30");
    expect(status.nextFreeFrom).toBe("14:30");
  });

  it("looks past the end of a run of touching bookings", () => {
    const status = roomAvailability([at("13:00", "14:00"), at("14:00", "15:00")], 13 * 60 + 30);
    expect(status.label).toBe("Busy until 15:00");
  });

  it("is closed before opening and after closing", () => {
    expect(roomAvailability([], 7 * 60).state).toBe("closed");
    expect(roomAvailability([], 22 * 60).state).toBe("closed");
  });

  it("counts only the bookable minutes still ahead", () => {
    // 20:00, nothing booked, closes at 22:00.
    expect(roomAvailability([], 20 * 60).freeMinutesLeft).toBe(120);
  });

  it("has no free minutes left once a busy room is booked out to closing", () => {
    expect(roomAvailability([at("20:00", "22:00")], 20 * 60).freeMinutesLeft).toBe(0);
  });
});

describe("quotaUsed", () => {
  it("counts nothing against a user with no bookings", () => {
    expect(quotaUsed([])).toEqual({ usedMinutes: 0, remainingMinutes: 120 });
  });

  it("counts time across several bookings", () => {
    expect(quotaUsed([at("09:00", "09:30"), at("14:00", "15:00")])).toEqual({
      usedMinutes: 90,
      remainingMinutes: 30,
    });
  });

  it("never reports a negative remainder", () => {
    expect(quotaUsed([at("09:00", "12:00")]).remainingMinutes).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats hours, minutes, and both", () => {
    expect(formatDuration(30)).toBe("30m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(90)).toBe("1h 30m");
  });
});

describe("bookingState", () => {
  const claim = (over: Partial<Parameters<typeof bookingState>[0]> = {}) => ({
    date: "2026-03-10",
    startTime: "13:00",
    endTime: "14:00",
    checkedInAt: null,
    ...over,
  });

  it("is upcoming on a later day", () => {
    expect(bookingState(claim(), "2026-03-09", 13 * 60)).toBe("upcoming");
  });

  it("is upcoming until check-in opens 15 minutes before the start", () => {
    expect(bookingState(claim(), "2026-03-10", 12 * 60 + 44)).toBe("upcoming");
    expect(bookingState(claim(), "2026-03-10", 12 * 60 + 45)).toBe("check-in-open");
  });

  it("stays claimable up to 15 minutes after the start", () => {
    expect(bookingState(claim(), "2026-03-10", 13 * 60 + 15)).toBe("check-in-open");
  });

  it("lapses once the holder is more than 15 minutes late", () => {
    expect(bookingState(claim(), "2026-03-10", 13 * 60 + 16)).toBe("released");
  });

  it("runs to the end once checked in, however late that was", () => {
    const claimed = claim({ checkedInAt: "2026-03-10 13:05:00" });
    expect(bookingState(claimed, "2026-03-10", 13 * 60 + 40)).toBe("in-progress");
    expect(bookingState(claimed, "2026-03-10", 14 * 60)).toBe("finished");
  });

  it("treats a past booking that was never claimed as released", () => {
    expect(bookingState(claim(), "2026-03-11", 9 * 60)).toBe("released");
  });
});

describe("liveBookings", () => {
  const unclaimed = {
    id: 1,
    date: "2026-03-10",
    startTime: "13:00",
    endTime: "14:00",
    checkedInAt: null,
  };
  const claimed = { ...unclaimed, id: 2, startTime: "15:00", endTime: "16:00", checkedInAt: "x" };

  it("hands an unclaimed room back so someone else can book it", () => {
    const live = liveBookings([unclaimed, claimed], "2026-03-10", 13 * 60 + 30);
    expect(live.map((b) => b.id)).toEqual([2]);
  });

  it("keeps a booking that is still inside its grace window", () => {
    const live = liveBookings([unclaimed, claimed], "2026-03-10", 13 * 60 + 10);
    expect(live.map((b) => b.id)).toEqual([1, 2]);
  });

  it("keeps every booking on a future day", () => {
    const live = liveBookings([unclaimed, claimed], "2026-03-09", 13 * 60 + 30);
    expect(live).toHaveLength(2);
  });

  it("frees the room in the availability view once a booking lapses", () => {
    const live = liveBookings([unclaimed], "2026-03-10", 13 * 60 + 30);
    expect(roomAvailability(live, 13 * 60 + 30).state).toBe("free");
  });
});

describe("libraryNow", () => {
  it("reads the wall clock in the library's timezone, not the host's", () => {
    // 2026-01-14T23:30:00Z is already the 15th in Canberra (UTC+11 in
    // January) — the case a UTC container would get wrong all afternoon.
    const now = libraryNow(new Date("2026-01-14T23:30:00Z"));
    expect(now.date).toBe("2026-01-15");
    expect(now.time).toBe("10:30");
    expect(now.minutes).toBe(630);
  });
});
