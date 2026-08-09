declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    INGESTION_HMAC_SECRET?: string;
    ADMIN_EMAILS?: string;
    CF_ACCESS_AUD?: string;
    CF_ACCESS_TEAM_DOMAIN?: string;
    LOCAL_SECURE_MODE?: string;
    LOCAL_ONBOARDING_URL?: string;
    LOCAL_PRICE_FEED_URL?: string;
  }
}

declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
}
