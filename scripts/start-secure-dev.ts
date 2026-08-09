import { spawn } from "node:child_process";
import { startAccountOnboardingServer } from "./lib/account-onboarding-server";
import { readIngestionSecret } from "./lib/keychain";
import { startNsePriceServer } from "./lib/nse-price-server";

async function main() {
  const secret = readIngestionSecret();
  const onboarding = await startAccountOnboardingServer({
    dashboardUrl: "http://localhost:3000",
  });
  const priceFeed = await startNsePriceServer({
    dashboardUrl: "http://localhost:3000",
  });
  process.stdout.write(
    `Local account setup is available from the dashboard.\nDirect setup URL: ${onboarding.url}\nExperimental NSE prices are enabled for this local session.\n`,
  );

  const child = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      INGESTION_HMAC_SECRET: secret,
      LOCAL_SECURE_MODE: "1",
      LOCAL_ONBOARDING_URL: onboarding.url,
      LOCAL_PRICE_FEED_URL: priceFeed.url,
    },
    stdio: "inherit",
  });

  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  child.on("error", async () => {
    await onboarding.close().catch(() => {});
    await priceFeed.close().catch(() => {});
    process.exitCode = 1;
  });
  child.on("exit", async (code, signal) => {
    await onboarding.close().catch(() => {});
    await priceFeed.close().catch(() => {});
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}

main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "SECURE_DEV_FAILED";
  process.stderr.write(`Secure dashboard failed to start: ${code}\n`);
  process.exitCode = 1;
});
