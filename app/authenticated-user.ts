import { headers } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getChatGPTUser } from "./chatgpt-auth";

export type AuthenticatedUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const access = cloudflareAccessConfiguration();
  if (access.state === "absent") return getChatGPTUser();
  if (access.state === "invalid") return null;

  const token = (await headers()).get("cf-access-jwt-assertion");
  if (!token) return null;

  try {
    const jwks = createRemoteJWKSet(
      new URL("/cdn-cgi/access/certs", access.teamDomain),
    );
    const { payload } = await jwtVerify(token, jwks, {
      audience: access.audience,
      issuer: access.teamDomain,
    });
    if (
      typeof payload.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
      payload.email.length > 254 ||
      typeof payload.sub !== "string" ||
      !payload.sub
    ) {
      return null;
    }
    return {
      userId: payload.sub,
      displayName: payload.email,
      email: payload.email,
      fullName: null,
    };
  } catch {
    return null;
  }
}

export function cloudflareAccessIsConfigured(): boolean {
  return cloudflareAccessConfiguration().state !== "absent";
}

type CloudflareAccessConfiguration =
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "valid"; audience: string; teamDomain: string };

function cloudflareAccessConfiguration(): CloudflareAccessConfiguration {
  const audience = process.env.CF_ACCESS_AUD;
  const configuredDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
  if (!audience && !configuredDomain) return { state: "absent" };
  if (!audience || !configuredDomain) return { state: "invalid" };

  try {
    const teamDomain = new URL(configuredDomain);
    if (
      teamDomain.protocol !== "https:" ||
      teamDomain.pathname !== "/" ||
      teamDomain.search ||
      teamDomain.hash ||
      teamDomain.username ||
      teamDomain.password ||
      teamDomain.port ||
      !teamDomain.hostname.endsWith(".cloudflareaccess.com") ||
      !/^[A-Za-z0-9_-]{16,256}$/.test(audience)
    ) {
      return { state: "invalid" };
    }
    return {
      state: "valid",
      audience,
      teamDomain: teamDomain.origin,
    };
  } catch {
    return { state: "invalid" };
  }
}
