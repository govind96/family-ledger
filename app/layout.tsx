import type { Metadata } from "next";
import { headers } from "next/headers";
import { THEME_INIT_SCRIPT } from "./theme";
import "./globals.css";

// Manrope is self-hosted from /public/fonts. The dashboard's own
// content-security-policy allows only same-origin styles and fonts, so a
// Google Fonts stylesheet would be blocked and the design would silently fall
// back to Arial. Self-hosting also keeps the private dashboard from making an
// outbound request on every page view.

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const requestHost =
    forwardedHost ?? requestHeaders.get("host") ?? "localhost:3000";
  const safeHost = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(requestHost)
    ? requestHost
    : "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto");
  const protocol =
    forwardedProtocol === "http" ||
    safeHost === "localhost" ||
    safeHost.startsWith("localhost:")
      ? "http"
      : "https";
  const origin = `${protocol}://${safeHost}`;
  const title = "Family Ledger — Private demat holdings";
  const description =
    "A private, view-only family dashboard for consolidated CDSL demat holdings.";

  return {
    metadataBase: new URL(origin),
    title,
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    robots: { index: false, follow: false, noarchive: true },
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
