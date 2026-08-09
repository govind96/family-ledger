import {
  assertMacOs,
  ingestionSecretExists,
  readIngestionSecret,
  storeIngestionSecret,
} from "./lib/keychain";
import { secureRandomHex } from "./lib/random";
import { confirm } from "./lib/secure-prompt";

async function main() {
  assertMacOs();
  if (ingestionSecretExists()) {
    let existingKeyIsValid = true;
    try {
      readIngestionSecret();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "INGESTION_SECRET_INVALID"
      ) {
        throw error;
      }
      existingKeyIsValid = false;
    }

    if (existingKeyIsValid) {
      const rotate = await confirm(
        "An ingestion signing key already exists. Rotate it? Existing workers will stop until restarted",
      );
      if (!rotate) {
        process.stdout.write("No changes made.\n");
        return;
      }
    } else {
      process.stdout.write(
        "The existing ingestion signing key is invalid and will be replaced.\n",
      );
    }
  }

  const secret = secureRandomHex(48);
  storeIngestionSecret(secret);
  process.stdout.write(
    "Ingestion signing key stored in macOS Keychain. It was not printed or written to disk.\n",
  );
}

main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "SETUP_FAILED";
  process.stderr.write(`Security setup failed: ${code}\n`);
  process.exitCode = 1;
});
