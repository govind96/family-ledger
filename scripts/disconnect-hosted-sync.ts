import {
  deleteHostedSyncConfig,
  hostedSyncConfigExists,
} from "./lib/keychain";
import { sanitizeErrorCode } from "./lib/error-code";

async function main() {
  if (!hostedSyncConfigExists()) {
    process.stdout.write("Hosted synchronization is not configured locally.\n");
    return;
  }
  deleteHostedSyncConfig();
  process.stdout.write(
    "Hosted synchronization details were removed from macOS Keychain.\n",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Hosted synchronization disconnect failed: ${sanitizeErrorCode(error)}\n`,
  );
  process.exitCode = 1;
});
