import {
  extractCdslHoldings,
  type CdslDiagnosticEvent,
  type CdslDiagnosticLogger,
} from "./lib/cdsl-connector";
import { readAccountConfig } from "./lib/account-config";
import {
  GmailOtpReader,
  gmailOtpIsConfigured,
  type GmailOtpAttempt,
} from "./lib/gmail-otp";
import { ingestSnapshot } from "./lib/ingest-client";
import {
  hostedSyncConfigExists,
  readCdslCredentials,
  readHostedSyncConfig,
  readIngestionSecret,
} from "./lib/keychain";
import { promptHidden, promptText } from "./lib/secure-prompt";
import { sanitizeErrorCode } from "./lib/error-code";

async function main() {
  const verbose = process.argv.includes("--verbose");
  const showBrowser = process.argv.includes("--show-browser");
  const manualOtp = process.argv.includes("--manual-otp");
  const diagnosticLogger = verbose ? createDiagnosticLogger() : undefined;
  if (verbose) {
    process.stderr.write(
      "Verbose diagnostics enabled. Secrets, cookies, bodies, page text, and URL queries are omitted.\n",
    );
  }
  if (showBrowser) {
    process.stderr.write(
      "Visible browser mode enabled. The disposable window may show private financial information.\n",
    );
  }
  const config = await readAccountConfig();
  const requestedPrefix = readArgument("--account");
  const enabled = config.accounts.filter((account) => account.enabled);
  const accounts = requestedPrefix
    ? enabled.filter((account) => account.id.startsWith(requestedPrefix))
    : enabled;

  if (!accounts.length) throw new Error("NO_ENABLED_ACCOUNTS");
  if (requestedPrefix && accounts.length !== 1) {
    throw new Error("ACCOUNT_REFERENCE_NOT_UNIQUE");
  }

  const ingestionSecret = readIngestionSecret();
  const hostedSync = hostedSyncConfigExists() ? readHostedSyncConfig() : null;
  const ingestionEndpoint =
    process.env.FAMILY_LEDGER_INGEST_URL ??
    hostedSync?.endpoint ??
    "http://localhost:3000/api/sync/ingest";
  const gmailOtpReader =
    !manualOtp && gmailOtpIsConfigured() ? new GmailOtpReader() : null;
  if (gmailOtpReader) {
    process.stdout.write(
      "Automatic Gmail OTP retrieval enabled for the configured collector inbox.\n",
    );
  } else {
    process.stdout.write(
      manualOtp
        ? "Manual OTP entry selected.\n"
        : "Gmail OTP collector is not configured; using manual OTP entry.\n",
    );
  }
  let failures = 0;

  try {
    for (const [index, account] of accounts.entries()) {
      process.stdout.write(
        `[${index + 1}/${accounts.length}] Syncing ${account.accountLabel} (${account.id.slice(0, 8)})\n`,
      );
      try {
        const otpAttempt: GmailOtpAttempt | null = gmailOtpReader
          ? await gmailOtpReader.beginAttempt()
          : null;
        const credentials = readCdslCredentials(account.id);
        const snapshot = await extractCdslHoldings({
          account,
          credentials,
          getOtp: async () => {
            if (gmailOtpReader && otpAttempt) {
              diagnosticLogger?.({ event: "gmail_otp.wait" });
              const otp = await gmailOtpReader.waitForOtp(otpAttempt);
              diagnosticLogger?.({ event: "gmail_otp.received" });
              return otp;
            }
            return promptHidden("Enter the current CDSL OTP (hidden)");
          },
          replaceActiveSession: true,
          log: diagnosticLogger,
          showBrowser,
          pauseOnFailure: showBrowser
            ? async () => {
                await promptText(
                  "Browser paused after the safe stop. Inspect it, then press Enter to close",
                );
              }
            : undefined,
        });
        diagnosticLogger?.({ event: "ingestion.start" });
        const syncId = await ingestSnapshot({
          snapshot,
          endpoint: ingestionEndpoint,
          secret: ingestionSecret,
          accessClientId:
            hostedSync && ingestionEndpoint === hostedSync.endpoint
              ? hostedSync.accessClientId
              : undefined,
          accessClientSecret:
            hostedSync && ingestionEndpoint === hostedSync.endpoint
              ? hostedSync.accessClientSecret
              : undefined,
        });
        process.stdout.write(
          `  Saved ${snapshot.holdings.length} reconciled holdings as ${syncId.slice(0, 8)}.\n`,
        );
        diagnosticLogger?.({ event: "ingestion.complete" });
      } catch (error) {
        failures += 1;
        const code = sanitizeErrorCode(error);
        process.stderr.write(`  Sync stopped safely: ${code}\n`);
      }
    }
  } finally {
    gmailOtpReader?.clearSecrets();
    if (hostedSync) {
      hostedSync.accessClientId = "";
      hostedSync.accessClientSecret = "";
    }
  }

  if (failures) {
    process.exitCode = 1;
    process.stderr.write(
      `${failures} account(s) failed. Existing dashboard snapshots were left unchanged.\n`,
    );
  }
}

function createDiagnosticLogger(): CdslDiagnosticLogger {
  return (diagnostic: CdslDiagnosticEvent) => {
    const details = Object.entries(diagnostic)
      .filter(([key, value]) => key !== "event" && value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");
    process.stderr.write(
      `  [${new Date().toISOString()}] ${diagnostic.event}${details ? ` ${details}` : ""}\n`,
    );
  };
}

function readArgument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? "";
}

main().catch((error: unknown) => {
  process.stderr.write(`Sync failed: ${sanitizeErrorCode(error)}\n`);
  process.exitCode = 1;
});
