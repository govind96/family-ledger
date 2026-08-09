import { getAuthenticatedUser } from "@/app/authenticated-user";
import { getPortfolioView } from "@/lib/portfolio";
import { isAuthorizedUser } from "@/lib/security/authorization";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return Response.json(
      { error: "AUTHENTICATION_REQUIRED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  if (!isAuthorizedUser(user)) {
    return Response.json(
      { error: "ACCESS_DENIED" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const portfolio = await getPortfolioView();
    return Response.json(portfolio, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "PORTFOLIO_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
