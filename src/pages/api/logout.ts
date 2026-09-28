import type { APIRoute } from "astro";
import { destroySession } from "../../lib/auth";

export const POST: APIRoute = ({ cookies, redirect }) => {
  destroySession(cookies);
  return redirect("/", 303);
};
