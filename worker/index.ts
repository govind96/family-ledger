/** Cloudflare Worker entry point for the Family Ledger application. */
import handler from "vinext/server/app-router-entry";

const worker = {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const headers = new Headers(request.headers);
    headers.delete("x-family-ledger-local-secure");
    headers.delete("x-family-ledger-local-onboarding-url");
    headers.delete("x-family-ledger-local-price-feed-url");
    if (env.LOCAL_SECURE_MODE === "1") {
      headers.set("x-family-ledger-local-secure", "1");
      if (env.LOCAL_ONBOARDING_URL) {
        headers.set(
          "x-family-ledger-local-onboarding-url",
          env.LOCAL_ONBOARDING_URL,
        );
      }
      if (isSafeLocalPriceFeedUrl(env.LOCAL_PRICE_FEED_URL)) {
        headers.set(
          "x-family-ledger-local-price-feed-url",
          env.LOCAL_PRICE_FEED_URL,
        );
      }
    }
    const routedRequest = new Request(request, { headers });
    const response = await handler.fetch(routedRequest, env, ctx);
    return applySecurityHeaders(request, response, env);
  },
} satisfies ExportedHandler<Cloudflare.Env>;

function applySecurityHeaders(
  request: Request,
  response: Response,
  env: Cloudflare.Env,
): Response {
  const url = new URL(request.url);
  const contentType = response.headers.get("content-type") ?? "";
  const shouldProtect =
    url.pathname.startsWith("/api/") || contentType.includes("text/html");
  if (!shouldProtect) return response;

  const secured = new Response(response.body, response);
  secured.headers.set("cache-control", "private, no-store");
  const localPriceOrigin =
    env.LOCAL_SECURE_MODE === "1" && isSafeLocalPriceFeedUrl(env.LOCAL_PRICE_FEED_URL)
      ? new URL(env.LOCAL_PRICE_FEED_URL!).origin
      : null;
  secured.headers.set(
    "content-security-policy",
    `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'${localPriceOrigin ? ` ${localPriceOrigin}` : ""}`,
  );
  secured.headers.set("cross-origin-opener-policy", "same-origin");
  secured.headers.set("cross-origin-resource-policy", "same-origin");
  secured.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  secured.headers.set("referrer-policy", "no-referrer");
  secured.headers.set("x-content-type-options", "nosniff");
  secured.headers.set("x-frame-options", "DENY");
  if (url.protocol === "https:") {
    secured.headers.set(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
  }
  return secured;
}

function isSafeLocalPriceFeedUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      /^\d{1,5}$/.test(url.port) &&
      /^\/local-price-feed\/[A-Za-z0-9_-]{43}\/snapshot$/.test(url.pathname) &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export default worker;
