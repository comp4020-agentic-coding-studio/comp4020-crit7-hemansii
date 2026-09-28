import type { APIRoute } from "astro";
import { createSession, hashPassword, isAnuEmail } from "../../lib/auth";
import { createUser, getUserByEmail } from "../../lib/db";

// Self-service signup, gated to @anu.edu.au addresses. This doesn't verify
// inbox ownership — no student prototype can reach the real ANU SSO — but a
// password now stands between "anyone can type your email" and booking as
// you, which is the actual protection being asked for.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");

  if (!isAnuEmail(email)) {
    return redirect(`/signup?error=not-anu-email&next=${encodeURIComponent(next)}`, 303);
  }
  if (password.length < 8) {
    return redirect(`/signup?error=weak-password&next=${encodeURIComponent(next)}`, 303);
  }
  if (getUserByEmail(email)) {
    return redirect(`/signup?error=email-taken&next=${encodeURIComponent(next)}`, 303);
  }

  const passwordHash = await hashPassword(password);
  const user = createUser(email, passwordHash);
  await createSession(user.id, cookies);
  return redirect(next, 303);
};
