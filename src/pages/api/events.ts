import type { APIRoute } from "astro";
import { bus, type BookingEvent } from "../../lib/events";

// The minimal server-sent-events (SSE) pattern: a long-lived streaming
// response the browser consumes with `new EventSource("/api/events")`.
// SSE is one-directional (server → browser) and plain HTTP, which makes it
// the simplest live channel that works everywhere — reach for WebSockets
// only when the client needs to push over the same connection.
//
// One global stream, not one per room: traffic is trivial for a class
// assignment, so every client subscribes here and filters incoming events by
// roomId/date on the client side rather than the server maintaining
// per-room topics.
export const GET: APIRoute = () => {
  let onBooking: (event: BookingEvent) => void;
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<string>({
    start(controller) {
      // an opening comment so the client (and the post-deploy CI probe) sees
      // bytes immediately, and a periodic one so proxies don't drop the
      // connection as idle
      controller.enqueue(": connected\n\n");
      heartbeat = setInterval(() => controller.enqueue(": ping\n\n"), 30_000);
      onBooking = (event) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
      };
      bus.on("booking", onBooking);
    },
    cancel() {
      clearInterval(heartbeat);
      bus.off("booking", onBooking);
    },
  });

  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
};
