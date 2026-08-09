import assert from "node:assert/strict";
import test from "node:test";
import {
  assertValidCdslCredentials,
  assertValidGmailOAuthCredentials,
  assertValidHostedSyncConfig,
  assertValidIngestionSecret,
} from "../scripts/lib/keychain";

test("rejects malformed or identical CDSL credentials before Keychain access", () => {
  assert.throws(
    () =>
      assertValidCdslCredentials({
        username: "invalid@email",
        password: "different-password",
      }),
    /INVALID_CDSL_USERNAME_FORMAT/,
  );
  assert.throws(
    () =>
      assertValidCdslCredentials({
        username: "same_value",
        password: "same_value",
      }),
    /CDSL_USERNAME_AND_PASSWORD_MUST_DIFFER/,
  );
});

test("validates hosted sync endpoints and machine tokens", () => {
  assert.doesNotThrow(() =>
    assertValidHostedSyncConfig({
      endpoint: "https://family-ledger.example.com/api/sync/ingest",
      accessClientId: "I".repeat(32),
      accessClientSecret: "S".repeat(64),
    }),
  );
  assert.throws(
    () =>
      assertValidHostedSyncConfig({
        endpoint: "http://localhost:3000/api/sync/ingest",
        accessClientId: "I".repeat(32),
        accessClientSecret: "S".repeat(64),
      }),
    /HOSTED_SYNC_CONFIG_INVALID/,
  );
  assert.throws(
    () =>
      assertValidHostedSyncConfig({
        endpoint: "https://family-ledger.example.com/not-ingestion",
        accessClientId: "I".repeat(32),
        accessClientSecret: "S".repeat(64),
      }),
    /HOSTED_SYNC_CONFIG_INVALID/,
  );
});

test("accepts a well-formed CDSL credential pair without reading Keychain", () => {
  assert.doesNotThrow(() =>
    assertValidCdslCredentials({
      username: "sample_user",
      password: "Synthet1c!",
    }),
  );
});

test("rejects weak or malformed ingestion secrets before Keychain access", () => {
  assert.throws(
    () => assertValidIngestionSecret("too-short"),
    /INGESTION_SECRET_INVALID/,
  );
  assert.throws(
    () => assertValidIngestionSecret(`${"a".repeat(43)}\n`),
    /INGESTION_SECRET_INVALID/,
  );
});

test("accepts a strong ingestion secret without reading Keychain", () => {
  assert.doesNotThrow(() => assertValidIngestionSecret("a".repeat(96)));
});

test("validates Gmail OAuth bundles before Keychain access", () => {
  assert.doesNotThrow(() =>
    assertValidGmailOAuthCredentials({
      clientId: `${"client-id".repeat(3)}.apps.googleusercontent.com`,
      clientSecret: "synthetic-client-secret",
      refreshToken: "synthetic-refresh-token-long-enough",
      email: "otp-collector@example.com",
    }),
  );
  assert.throws(
    () =>
      assertValidGmailOAuthCredentials({
        clientId: "not-a-google-client",
        clientSecret: "secret",
        refreshToken: "synthetic-refresh-token-long-enough",
        email: "otp-collector@example.com",
      }),
    /GMAIL_OAUTH_CREDENTIALS_INVALID/,
  );
});
