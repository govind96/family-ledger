import {
  deleteGmailOAuthCredentials,
  readGmailOAuthCredentials,
} from "./lib/keychain";
import { sanitizeErrorCode } from "./lib/error-code";

async function main() {
  const credentials = readGmailOAuthCredentials();
  let remotelyRevoked = false;
  try {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: credentials.refreshToken }),
      signal: AbortSignal.timeout(30_000),
    });
    remotelyRevoked = response.ok;
  } finally {
    credentials.clientSecret = "";
    credentials.refreshToken = "";
    deleteGmailOAuthCredentials();
  }
  if (!remotelyRevoked) {
    throw new Error("GMAIL_ACCESS_REMOVED_LOCALLY_REMOTE_REVOCATION_FAILED");
  }
  process.stdout.write("Gmail OTP access revoked and removed from Keychain.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Gmail disconnect failed: ${sanitizeErrorCode(error)}\n`,
  );
  process.exitCode = 1;
});
