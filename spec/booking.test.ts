import { beforeAll, describe, expect, inject, it } from "vitest";

// Drives the running app over HTTP to check the study-room booking flow end
// to end: signup gating, booking persistence, live updates, and the business
// rules in src/lib/bookings.ts. Each test uses a unique email/time slot so
// scenarios don't interfere with each other in the one shared throwaway DB.
const baseUrl = inject("baseUrl");

// Astro checks form POSTs carry a same-origin Origin header (CSRF
// protection); browsers send it automatically, a bare fetch doesn't.
const post = (path: string, body: URLSearchParams, cookie?: string) =>
  fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { origin: baseUrl, ...(cookie ? { cookie } : {}) },
    body,
    redirect: "manual",
  });

const get = (path: string, cookie?: string) =>
  fetch(new URL(path, baseUrl), { headers: cookie ? { cookie } : {} });

// fetch doesn't manage cookies itself; extract the session cookie from a
// Set-Cookie header and pass it back manually on later requests.
function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no Set-Cookie header on response");
  return setCookie.split(";")[0];
}

async function signUp(emailLocal: string, password = "hunter22"): Promise<string> {
  const res = await post(
    "/api/signup",
    new URLSearchParams({ email: `${emailLocal}@anu.edu.au`, password, next: "/" }),
  );
  expect(res.status).toBe(303);
  return sessionCookie(res);
}

// today + N days as YYYY-MM-DD, matching the room page's own date math.
function dateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("booking", () => {
  let uid: string;

  beforeAll(() => {
    uid = String(process.hrtime.bigint());
  });

  it("signup with an ANU email persists a session", async () => {
    const cookie = await signUp(`student-${uid}-a`);
    const res = await get("/bookings", cookie);
    expect(res.status).toBe(200);
  });

  it("rejects signup with a non-ANU email", async () => {
    const res = await post(
      "/api/signup",
      new URLSearchParams({ email: `nope-${uid}@example.com`, password: "hunter22", next: "/" }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("error=not-anu-email");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("persists a booking across a reload", async () => {
    const cookie = await signUp(`student-${uid}-b`);
    const date = dateInDays(1);
    const res = await post(
      "/api/bookings/create",
      new URLSearchParams({ roomId: "1", date, startTime: "09:00", endTime: "10:00" }),
      cookie,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).not.toContain("error=");

    const page = await get(`/rooms/1/?date=${date}`);
    expect(await page.text()).toContain("09:00");
  });

  it("broadcasts a new booking over the SSE stream", async () => {
    const cookie = await signUp(`student-${uid}-c`);
    const date = dateInDays(2);

    const stream = await fetch(new URL("/api/events", baseUrl));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("no response body");

    await post(
      "/api/bookings/create",
      new URLSearchParams({ roomId: "2", date, startTime: "11:00", endTime: "12:00" }),
      cookie,
    );

    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes(date)) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before the event arrived");
      received += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    expect(received).toContain("11:00");
  }, 10_000);

  it("rejects an overlapping booking in the same room", async () => {
    const cookie = await signUp(`student-${uid}-d`);
    const date = dateInDays(3);
    await post(
      "/api/bookings/create",
      new URLSearchParams({ roomId: "3", date, startTime: "13:00", endTime: "14:00" }),
      cookie,
    );

    const other = await signUp(`student-${uid}-e`);
    const res = await post(
      "/api/bookings/create",
      new URLSearchParams({ roomId: "3", date, startTime: "13:30", endTime: "14:30" }),
      other,
    );
    expect(res.headers.get("location")).toContain("error=overlap");
  });

  it("rejects exceeding the 2-hour daily cap", async () => {
    const cookie = await signUp(`student-${uid}-f`);
    const date = dateInDays(4);
    await post(
      "/api/bookings/create",
      new URLSearchParams({ roomId: "4", date, startTime: "08:00", endTime: "10:00" }),
      cookie,
    );
    const res = await post(
      "/api/bookings/create",
      new URLSearchParams({ roomId: "5", date, startTime: "10:00", endTime: "10:30" }),
      cookie,
    );
    expect(res.headers.get("location")).toContain("error=daily-cap");
  });

  it("rejects booking more than 14 days out", async () => {
    const cookie = await signUp(`student-${uid}-g`);
    const date = dateInDays(20);
    const res = await post(
      "/api/bookings/create",
      new URLSearchParams({ roomId: "6", date, startTime: "09:00", endTime: "10:00" }),
      cookie,
    );
    expect(res.headers.get("location")).toContain("error=too-far-out");
  });

  it("cancelling a booking frees the slot for rebooking", async () => {
    const cookie = await signUp(`student-${uid}-h`);
    const date = dateInDays(5);
    await post(
      "/api/bookings/create",
      new URLSearchParams({ roomId: "1", date, startTime: "15:00", endTime: "16:00" }),
      cookie,
    );

    const before = await get("/bookings", cookie);
    const match = (await before.text()).match(/name="id" value="(\d+)"/);
    if (!match) throw new Error("could not find booking id on /bookings");
    const id = match[1];

    const cancel = await post("/api/bookings/cancel", new URLSearchParams({ id }), cookie);
    expect(cancel.status).toBe(303);

    const after = await get("/bookings", cookie);
    expect(await after.text()).not.toContain("15:00");

    const rebook = await post(
      "/api/bookings/create",
      new URLSearchParams({ roomId: "1", date, startTime: "15:00", endTime: "16:00" }),
      cookie,
    );
    expect(rebook.headers.get("location")).not.toContain("error=");
  });
});
