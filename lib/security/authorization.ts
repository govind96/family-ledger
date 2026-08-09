import type { AuthenticatedUser } from "@/app/authenticated-user";
import { getEnvironment } from "@/db/runtime";

export function isAuthorizedUser(user: AuthenticatedUser): boolean {
  const configured = getEnvironment().ADMIN_EMAILS ?? process.env.ADMIN_EMAILS;
  if (!configured) return false;

  const allowed = new Set(
    configured
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  return allowed.has(user.email.toLowerCase());
}
