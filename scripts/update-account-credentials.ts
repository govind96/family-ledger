import {
  resolveAccountReference,
  updateLocalCdslCredentials,
} from "./lib/account-management";
import { readAccountConfig } from "./lib/account-config";
import { assertValidCdslCredentials } from "./lib/keychain";
import { confirm, promptHidden, promptText } from "./lib/secure-prompt";

async function main() {
  const config = await readAccountConfig();
  if (!config.accounts.length) throw new Error("NO_CONFIGURED_ACCOUNTS");

  for (const account of config.accounts) {
    process.stdout.write(
      `${account.id.slice(0, 8)}  ${account.ownerLabel} / ${account.accountLabel}  •••• ${account.boidLast4}\n`,
    );
  }
  const requested = readArgument("--account");
  const reference =
    requested ??
    (await promptText("Account reference to update", { required: true }));
  const target = resolveAccountReference(config.accounts, reference);
  const approved = await confirm(
    `Replace the stored CDSL username and password for ${target.ownerLabel} / ${target.accountLabel}`,
  );
  if (!approved) {
    process.stdout.write("No changes made.\n");
    return;
  }

  let username = "";
  let password = "";
  try {
    username = await promptHidden("CDSL EASI username (hidden)");
    password = await promptHidden("CDSL EASI password (hidden)");
    assertValidCdslCredentials({ username, password });
    await updateLocalCdslCredentials(target.id, { username, password });
    process.stdout.write(
      `Credentials updated for ${target.accountLabel} (${target.id.slice(0, 8)}).\n`,
    );
  } finally {
    username = "";
    password = "";
  }
}

function readArgument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? "";
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error ? error.message : "CREDENTIAL_UPDATE_FAILED";
  process.stderr.write(`Credential update failed: ${code}\n`);
  process.exitCode = 1;
});
