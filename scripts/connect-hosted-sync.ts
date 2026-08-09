import {
  assertValidHostedSyncConfig,
  storeHostedSyncConfig,
} from "./lib/keychain";
import { promptHidden } from "./lib/secure-prompt";
import { sanitizeErrorCode } from "./lib/error-code";

async function main() {
  const endpoint = readArgument("--endpoint");
  if (!endpoint) throw new Error("HOSTED_SYNC_ENDPOINT_REQUIRED");

  let accessClientId = "";
  let accessClientSecret = "";
  try {
    accessClientId = await promptHidden(
      "Cloudflare Access service-token client ID (hidden)",
    );
    accessClientSecret = await promptHidden(
      "Cloudflare Access service-token client secret (hidden)",
    );
    const config = { endpoint, accessClientId, accessClientSecret };
    assertValidHostedSyncConfig(config);
    storeHostedSyncConfig(config);
    process.stdout.write(
      "Hosted synchronization connected. The endpoint and Cloudflare service credentials are stored only in macOS Keychain.\n",
    );
  } finally {
    accessClientId = "";
    accessClientSecret = "";
  }
}

function readArgument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) return null;
  return process.argv[index + 1];
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Hosted synchronization setup failed: ${sanitizeErrorCode(error)}\n`,
  );
  process.exitCode = 1;
});
