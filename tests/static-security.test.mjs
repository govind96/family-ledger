import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps local account config and environment files out of source control", async () => {
  const gitignore = await readFile(new URL(".gitignore", root), "utf8");
  assert.match(gitignore, /config\/accounts\.local\.json/);
  assert.match(gitignore, /^\.env\*/m);
  assert.match(gitignore, /playwright\/\.auth/);
});

test("database schema has no credential, OTP, PAN, or session columns", async () => {
  const schema = await readFile(new URL("db/schema.ts", root), "utf8");
  assert.doesNotMatch(
    schema,
    /["'](?:username|password|otp|pan|session_cookie)["']/i,
  );
});

test("Keychain writes use the native helper without secret process arguments", async () => {
  const source = await readFile(
    new URL("scripts/lib/keychain.ts", root),
    "utf8",
  );
  const helper = await readFile(
    new URL("scripts/keychain-helper.c", root),
    "utf8",
  );
  assert.match(source, /spawnSync\(binary, \[\], \{/);
  assert.match(source, /input,/);
  assert.doesNotMatch(source, /add-generic-password/);
  assert.doesNotMatch(source, /"-w",\s*secret/);
  assert.match(helper, /SecItemUpdate/);
  assert.match(helper, /SecItemAdd/);
  assert.match(helper, /read\(\s*STDIN_FILENO/);
});

test("the ingestion key is a Worker secret, not a serialized config variable", async () => {
  const viteConfig = await readFile(new URL("vite.config.ts", root), "utf8");
  assert.match(
    viteConfig,
    /secrets:\s*\{\s*required:\s*\["INGESTION_HMAC_SECRET"\]/,
  );
  assert.doesNotMatch(
    viteConfig,
    /INGESTION_HMAC_SECRET:\s*process\.env\.INGESTION_HMAC_SECRET/,
  );
});

test("account onboarding remains outside the dashboard worker", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  const worker = await readFile(new URL("worker/index.ts", root), "utf8");
  const onboarding = await readFile(
    new URL("scripts/lib/account-onboarding-server.ts", root),
    "utf8",
  );
  assert.doesNotMatch(
    `${page}\n${worker}`,
    /storeCdslCredentials|keychain-helper/,
  );
  assert.match(onboarding, /listen\(0, "127\.0\.0\.1"/);
  assert.match(onboarding, /INVALID_FORM_ORIGIN/);
  assert.match(onboarding, /frame-ancestors 'none'/);
});

test("visible diagnostic mode still uses a disposable browser context", async () => {
  const source = await readFile(
    new URL("scripts/lib/cdsl-connector.ts", root),
    "utf8",
  );
  assert.match(source, /headless: !input\.showBrowser/);
  assert.match(source, /browser\.newContext\(/);
  assert.doesNotMatch(source, /launchPersistentContext|storageState\s*:/);
});

test("CDSL CSV parsing never persists the raw download", async () => {
  const source = await readFile(
    new URL("scripts/lib/cdsl-connector.ts", root),
    "utf8",
  );
  assert.match(source, /acceptDownloads:\s*true/);
  assert.match(source, /download\.createReadStream\(\)/);
  assert.doesNotMatch(source, /download\.(?:path|saveAs)\(/);
});

test("Gmail OTP access is read-only, revocable, and stored through Keychain", async () => {
  const connect = await readFile(
    new URL("scripts/connect-gmail-otp.ts", root),
    "utf8",
  );
  const reader = await readFile(
    new URL("scripts/lib/gmail-otp.ts", root),
    "utf8",
  );
  const keychain = await readFile(
    new URL("scripts/lib/keychain.ts", root),
    "utf8",
  );
  assert.match(
    connect,
    /https:\/\/www\.googleapis\.com\/auth\/gmail\.readonly/,
  );
  assert.doesNotMatch(
    `${connect}\n${reader}`,
    /gmail\.(?:modify|compose|send)|mail\.google\.com/,
  );
  assert.match(connect, /code_challenge_method:\s*"S256"/);
  assert.match(keychain, /com\.family-ledger\.gmail\.oauth\.v1/);
  assert.match(keychain, /com\.family-ledger\.hosted-sync\.v1/);
  assert.doesNotMatch(reader, /writeFile|appendFile|createWriteStream/);
});

test("hosted ingestion keeps machine access in Keychain and retains HMAC authentication", async () => {
  const sync = await readFile(new URL("scripts/cdsl-sync.ts", root), "utf8");
  const client = await readFile(
    new URL("scripts/lib/ingest-client.ts", root),
    "utf8",
  );
  assert.match(client, /cf-access-client-id/);
  assert.match(client, /cf-access-client-secret/);
  assert.match(client, /x-sync-signature/);
  assert.match(sync, /readHostedSyncConfig/);
  assert.doesNotMatch(sync, /console\.log\([^)]*accessClientSecret/);
});
