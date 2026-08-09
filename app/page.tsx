import { headers } from "next/headers";
import { getChatGPTUser, chatGPTSignInPath } from "./chatgpt-auth";
import {
  cloudflareAccessIsConfigured,
  getAuthenticatedUser,
} from "./authenticated-user";
import { AccessGate } from "./components/AccessGate";
import { PortfolioDashboard } from "./components/PortfolioDashboard";
import { demoPortfolio } from "@/lib/demo-portfolio";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  const connectingIp = requestHeaders.get("cf-connecting-ip");
  const loopbackHost =
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:") ||
    host === "[::1]" ||
    host.startsWith("[::1]:");
  const loopbackClient =
    !connectingIp ||
    connectingIp === "127.0.0.1" ||
    connectingIp === "::1";
  const localPreview = loopbackHost && loopbackClient;
  const localSecureMode =
    requestHeaders.get("x-family-ledger-local-secure") === "1";
  const localOnboardingUrl = localSecureMode
    ? safeLocalOnboardingUrl(
        requestHeaders.get("x-family-ledger-local-onboarding-url"),
      )
    : undefined;
  const localPriceFeedUrl = localSecureMode
    ? safeLocalPriceFeedUrl(
        requestHeaders.get("x-family-ledger-local-price-feed-url"),
      )
    : undefined;
  const user = localPreview
    ? await getChatGPTUser()
    : await getAuthenticatedUser();

  if (localPreview) {
    if (localSecureMode) {
      let portfolio;
      try {
        const { getPortfolioView } = await import("@/lib/portfolio");
        portfolio = await getPortfolioView();
      } catch {
        return <AccessGate kind="local-unavailable" />;
      }
      return (
        <PortfolioDashboard
          portfolio={portfolio}
          viewerName="Local secure view"
          localOnboardingUrl={localOnboardingUrl}
          localPriceFeedUrl={localPriceFeedUrl}
        />
      );
    }

    return (
      <PortfolioDashboard
        portfolio={demoPortfolio}
        viewerName="Local preview"
      />
    );
  }

  if (!user) {
    if (cloudflareAccessIsConfigured()) {
      return <AccessGate kind="hosted-auth-failed" />;
    }
    return (
      <AccessGate
        kind="signed-out"
        signInPath={chatGPTSignInPath("/")}
      />
    );
  }

  const { isAuthorizedUser } = await import("@/lib/security/authorization");
  if (!isAuthorizedUser(user)) {
    return <AccessGate kind="unauthorized" viewerEmail={user.email} />;
  }

  let portfolio;
  try {
    const { getPortfolioView } = await import("@/lib/portfolio");
    portfolio = await getPortfolioView();
  } catch {
    return <AccessGate kind="unavailable" viewerEmail={user.email} />;
  }
  return (
    <PortfolioDashboard
      portfolio={portfolio}
      viewerName={user.fullName ?? user.email}
    />
  );
}

function safeLocalOnboardingUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !/^\d{1,5}$/.test(url.port) ||
      !/^\/local-account-setup\/[A-Za-z0-9_-]{43}$/.test(url.pathname) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function safeLocalPriceFeedUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !/^\d{1,5}$/.test(url.port) ||
      !/^\/local-price-feed\/[A-Za-z0-9_-]{43}\/snapshot$/.test(
        url.pathname,
      ) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}
