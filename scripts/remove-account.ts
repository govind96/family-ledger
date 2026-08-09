import { deleteCdslCredentials } from "./lib/keychain";
import { readAccountConfig, writeAccountConfig } from "./lib/account-config";
import { confirm, promptText } from "./lib/secure-prompt";

async function main() {
  const config = await readAccountConfig();
  if (!config.accounts.length) {
    process.stdout.write("No local CDSL accounts are configured.\n");
    return;
  }
  for (const account of config.accounts) {
    process.stdout.write(
      `${account.id.slice(0, 8)}  ${account.ownerLabel} / ${account.accountLabel}  •••• ${account.boidLast4}\n`,
    );
  }
  const prefix = await promptText("Account reference to remove", { required: true });
  const matches = config.accounts.filter((account) => account.id.startsWith(prefix));
  if (matches.length !== 1) throw new Error("ACCOUNT_REFERENCE_NOT_UNIQUE");
  const target = matches[0];
  const approved = await confirm(
    `Remove ${target.ownerLabel} / ${target.accountLabel} and delete its Keychain credentials`,
  );
  if (!approved) {
    process.stdout.write("No changes made.\n");
    return;
  }

  deleteCdslCredentials(target.id);
  await writeAccountConfig({
    ...config,
    accounts: config.accounts.filter((account) => account.id !== target.id),
  });
  process.stdout.write(
    "Local account configuration and Keychain credentials were removed. Historical dashboard snapshots were not deleted.\n",
  );
}

main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "ACCOUNT_REMOVAL_FAILED";
  process.stderr.write(`Account removal failed: ${code}\n`);
  process.exitCode = 1;
});
