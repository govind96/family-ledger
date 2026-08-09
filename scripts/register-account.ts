import { addLocalCdslAccount } from "./lib/account-management";
import { assertValidCdslCredentials } from "./lib/keychain";
import { confirm, promptHidden, promptText } from "./lib/secure-prompt";

async function main() {
  process.stdout.write(
    "Add a CDSL EASI account. Credentials are stored only in macOS Keychain.\n\n",
  );
  const ownerConsented = await confirm(
    "Has the account holder explicitly approved daily view-only holdings access",
  );
  if (!ownerConsented) throw new Error("OWNER_CONSENT_REQUIRED");

  const ownerLabel = await promptText("Owner display name (optional)");
  const accountLabel = await promptText("Account nickname (optional)");
  const brokerLabel = await promptText("Broker / DP label (optional)");
  const boidLast4 = await promptText("Last four digits of CDSL BO ID", {
    validate: (value) =>
      !value || /^\d{4}$/.test(value) ? null : "Enter exactly four digits.",
  });

  let username = "";
  let password = "";
  try {
    username = await promptHidden("CDSL EASI username (hidden)");
    password = await promptHidden("CDSL EASI password (hidden)");
    assertValidCdslCredentials({ username, password });
    const account = await addLocalCdslAccount({
      ownerLabel,
      accountLabel,
      brokerLabel,
      boidLast4,
      ownerConsented,
      credentials: { username, password },
    });
    process.stdout.write(
      `Account added with local reference ${account.id.slice(0, 8)}. No PAN or full BO ID was stored.\n`,
    );
  } finally {
    username = "";
    password = "";
  }
}

main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "ACCOUNT_SETUP_FAILED";
  process.stderr.write(`Account setup failed: ${code}\n`);
  process.exitCode = 1;
});
