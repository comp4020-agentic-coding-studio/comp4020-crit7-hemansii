import type { APIRoute } from "astro";
import { createSession, verifyPassword } from "../../lib/auth";
import { getUserByEmail } from "../../lib/db";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");

  const user = getUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return redirect(`/login?error=invalid-credentials&next=${encodeURIComponent(next)}`, 303);
  }

  await createSession(user.id, cookies);
  return redirect(next, 303);
};
