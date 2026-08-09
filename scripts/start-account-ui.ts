import { startAccountOnboardingServer } from "./lib/account-onboarding-server";

const server = await startAccountOnboardingServer({
  dashboardUrl: "http://localhost:3000",
});

process.stdout.write(
  `Local account setup is ready. Open this private URL:\n${server.url}\n\nPress Ctrl+C when finished.\n`,
);

const stop = async () => {
  await server.close().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
