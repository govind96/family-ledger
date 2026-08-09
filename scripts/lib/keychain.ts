import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  chmodSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SECURITY_BINARY = "/usr/bin/security";
const XCRUN_BINARY = "/usr/bin/xcrun";
const CDSL_CREDENTIALS_SERVICE = "com.family-ledger.cdsl.credentials.v1";
const LEGACY_CDSL_SERVICE_PREFIX = "com.family-ledger.cdsl";
const INGESTION_SERVICE = "com.family-ledger.ingestion.v2";
const LEGACY_INGESTION_SERVICE = "com.family-ledger.ingestion";
const INGESTION_ACCOUNT = "hmac-v1";
const GMAIL_OAUTH_SERVICE = "com.family-ledger.gmail.oauth.v1";
const GMAIL_OAUTH_ACCOUNT = "otp-collector";
const HOSTED_SYNC_SERVICE = "com.family-ledger.hosted-sync.v1";
const HOSTED_SYNC_ACCOUNT = "production";
const MIN_INGESTION_SECRET_BYTES = 43;
const MAX_INGESTION_SECRET_BYTES = 512;
const HELPER_SOURCE = fileURLToPath(
  new URL("../keychain-helper.c", import.meta.url),
);
const HELPER_DIRECTORY = fileURLToPath(
  new URL("../../.local/keychain", import.meta.url),
);
const HELPER_BINARY = path.join(HELPER_DIRECTORY, "family-ledger-keychain");

export type CdslCredentials = {
  username: string;
  password: string;
};

export type GmailOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  email: string;
};

export type HostedSyncConfig = {
  endpoint: string;
  accessClientId: string;
  accessClientSecret: string;
};

export function assertMacOs(): void {
  if (process.platform !== "darwin") {
    throw new Error(
      "KEYCHAIN_UNAVAILABLE: the MVP vault adapter requires macOS",
    );
  }
}

export function assertValidCdslCredentials(credentials: CdslCredentials): void {
  if (!/^[A-Za-z0-9_]{6,16}$/.test(credentials.username)) {
    throw new Error("INVALID_CDSL_USERNAME_FORMAT");
  }
  if (credentials.password.length < 6 || credentials.password.length > 16) {
    throw new Error("INVALID_CDSL_PASSWORD_FORMAT");
  }
  if (credentials.username === credentials.password) {
    throw new Error("CDSL_USERNAME_AND_PASSWORD_MUST_DIFFER");
  }
}

export function storeCdslCredentials(
  accountId: string,
  credentials: CdslCredentials,
): void {
  assertMacOs();
  assertValidCdslCredentials(credentials);
  const bundle = JSON.stringify(credentials);
  writeNativeSecret(CDSL_CREDENTIALS_SERVICE, accountId, bundle);
  deleteLegacySecret(`${LEGACY_CDSL_SERVICE_PREFIX}.username`, accountId);
  deleteLegacySecret(`${LEGACY_CDSL_SERVICE_PREFIX}.password`, accountId);
}

export function readCdslCredentials(accountId: string): CdslCredentials {
  assertMacOs();
  const bundle = readNativeSecret(CDSL_CREDENTIALS_SERVICE, accountId);
  if (bundle !== null) return parseCredentialBundle(bundle);

  const credentials = {
    username: readLegacySecret(
      `${LEGACY_CDSL_SERVICE_PREFIX}.username`,
      accountId,
    ),
    password: readLegacySecret(
      `${LEGACY_CDSL_SERVICE_PREFIX}.password`,
      accountId,
    ),
  };
  assertValidCdslCredentials(credentials);
  return credentials;
}

export function deleteCdslCredentials(accountId: string): void {
  assertMacOs();
  deleteNativeSecret(CDSL_CREDENTIALS_SERVICE, accountId);
  deleteLegacySecret(`${LEGACY_CDSL_SERVICE_PREFIX}.username`, accountId);
  deleteLegacySecret(`${LEGACY_CDSL_SERVICE_PREFIX}.password`, accountId);
}

export function storeIngestionSecret(secret: string): void {
  assertMacOs();
  assertValidIngestionSecret(secret);
  writeNativeSecret(INGESTION_SERVICE, INGESTION_ACCOUNT, secret);
  deleteLegacySecret(LEGACY_INGESTION_SERVICE, INGESTION_ACCOUNT);
}

export function readIngestionSecret(): string {
  assertMacOs();
  const secret = readNativeSecret(INGESTION_SERVICE, INGESTION_ACCOUNT);
  const resolved =
    secret ?? readLegacySecret(LEGACY_INGESTION_SERVICE, INGESTION_ACCOUNT);
  assertValidIngestionSecret(resolved);
  return resolved;
}

export function storeGmailOAuthCredentials(
  credentials: GmailOAuthCredentials,
): void {
  assertMacOs();
  assertValidGmailOAuthCredentials(credentials);
  writeNativeSecret(
    GMAIL_OAUTH_SERVICE,
    GMAIL_OAUTH_ACCOUNT,
    JSON.stringify(credentials),
  );
}

export function readGmailOAuthCredentials(): GmailOAuthCredentials {
  assertMacOs();
  const bundle = readNativeSecret(GMAIL_OAUTH_SERVICE, GMAIL_OAUTH_ACCOUNT);
  if (bundle === null) throw new Error("GMAIL_OAUTH_NOT_CONFIGURED");
  return parseGmailOAuthBundle(bundle);
}

export function gmailOAuthCredentialsExist(): boolean {
  assertMacOs();
  return nativeSecretExists(GMAIL_OAUTH_SERVICE, GMAIL_OAUTH_ACCOUNT);
}

export function deleteGmailOAuthCredentials(): void {
  assertMacOs();
  deleteNativeSecret(GMAIL_OAUTH_SERVICE, GMAIL_OAUTH_ACCOUNT);
}

export function storeHostedSyncConfig(config: HostedSyncConfig): void {
  assertMacOs();
  assertValidHostedSyncConfig(config);
  writeNativeSecret(
    HOSTED_SYNC_SERVICE,
    HOSTED_SYNC_ACCOUNT,
    JSON.stringify(config),
  );
}

export function readHostedSyncConfig(): HostedSyncConfig {
  assertMacOs();
  const bundle = readNativeSecret(HOSTED_SYNC_SERVICE, HOSTED_SYNC_ACCOUNT);
  if (bundle === null) throw new Error("HOSTED_SYNC_NOT_CONFIGURED");
  return parseHostedSyncBundle(bundle);
}

export function hostedSyncConfigExists(): boolean {
  assertMacOs();
  return nativeSecretExists(HOSTED_SYNC_SERVICE, HOSTED_SYNC_ACCOUNT);
}

export function deleteHostedSyncConfig(): void {
  assertMacOs();
  deleteNativeSecret(HOSTED_SYNC_SERVICE, HOSTED_SYNC_ACCOUNT);
}

export function assertValidIngestionSecret(secret: string): void {
  const byteLength = Buffer.byteLength(secret, "utf8");
  if (
    byteLength < MIN_INGESTION_SECRET_BYTES ||
    byteLength > MAX_INGESTION_SECRET_BYTES ||
    /[\0\r\n]/.test(secret)
  ) {
    throw new Error("INGESTION_SECRET_INVALID");
  }
}

export function assertValidGmailOAuthCredentials(
  credentials: GmailOAuthCredentials,
): void {
  if (
    !/^[A-Za-z0-9._-]{20,200}\.apps\.googleusercontent\.com$/.test(
      credentials.clientId,
    ) ||
    credentials.clientSecret.length < 6 ||
    credentials.clientSecret.length > 512 ||
    /[\0\r\n]/.test(credentials.clientSecret) ||
    credentials.refreshToken.length < 20 ||
    credentials.refreshToken.length > 2048 ||
    /[\0\r\n]/.test(credentials.refreshToken) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentials.email) ||
    credentials.email.length > 254
  ) {
    throw new Error("GMAIL_OAUTH_CREDENTIALS_INVALID");
  }
}

export function assertValidHostedSyncConfig(config: HostedSyncConfig): void {
  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    throw new Error("HOSTED_SYNC_CONFIG_INVALID");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.pathname !== "/api/sync/ingest" ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password ||
    (endpoint.port && endpoint.port !== "443") ||
    endpoint.hostname.length > 253 ||
    !/^[a-z0-9.-]+$/i.test(endpoint.hostname) ||
    endpoint.hostname === "localhost" ||
    endpoint.hostname.endsWith(".localhost") ||
    !/^[A-Za-z0-9._~-]{20,512}$/.test(config.accessClientId) ||
    !/^[A-Za-z0-9._~-]{32,4096}$/.test(config.accessClientSecret)
  ) {
    throw new Error("HOSTED_SYNC_CONFIG_INVALID");
  }
}

export function ingestionSecretExists(): boolean {
  assertMacOs();
  return (
    nativeSecretExists(INGESTION_SERVICE, INGESTION_ACCOUNT) ||
    legacySecretExists(LEGACY_INGESTION_SERVICE, INGESTION_ACCOUNT)
  );
}

function parseCredentialBundle(value: string): CdslCredentials {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("username" in parsed) ||
      !("password" in parsed) ||
      typeof parsed.username !== "string" ||
      typeof parsed.password !== "string"
    ) {
      throw new Error("INVALID_KEYCHAIN_CREDENTIAL_BUNDLE");
    }
    const credentials = {
      username: parsed.username,
      password: parsed.password,
    };
    assertValidCdslCredentials(credentials);
    return credentials;
  } catch (error) {
    if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) {
      throw error;
    }
    throw new Error("INVALID_KEYCHAIN_CREDENTIAL_BUNDLE");
  }
}

function parseGmailOAuthBundle(value: string): GmailOAuthCredentials {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("clientId" in parsed) ||
      !("clientSecret" in parsed) ||
      !("refreshToken" in parsed) ||
      !("email" in parsed) ||
      typeof parsed.clientId !== "string" ||
      typeof parsed.clientSecret !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.email !== "string"
    ) {
      throw new Error("GMAIL_OAUTH_CREDENTIALS_INVALID");
    }
    const credentials = {
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      refreshToken: parsed.refreshToken,
      email: parsed.email,
    };
    assertValidGmailOAuthCredentials(credentials);
    return credentials;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "GMAIL_OAUTH_CREDENTIALS_INVALID"
    ) {
      throw error;
    }
    throw new Error("GMAIL_OAUTH_CREDENTIALS_INVALID");
  }
}

function parseHostedSyncBundle(value: string): HostedSyncConfig {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("endpoint" in parsed) ||
      !("accessClientId" in parsed) ||
      !("accessClientSecret" in parsed) ||
      typeof parsed.endpoint !== "string" ||
      typeof parsed.accessClientId !== "string" ||
      typeof parsed.accessClientSecret !== "string"
    ) {
      throw new Error("HOSTED_SYNC_CONFIG_INVALID");
    }
    const config = {
      endpoint: parsed.endpoint,
      accessClientId: parsed.accessClientId,
      accessClientSecret: parsed.accessClientSecret,
    };
    assertValidHostedSyncConfig(config);
    return config;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "HOSTED_SYNC_CONFIG_INVALID"
    ) {
      throw error;
    }
    throw new Error("HOSTED_SYNC_CONFIG_INVALID");
  }
}

function writeNativeSecret(
  service: string,
  account: string,
  secret: string,
): void {
  runKeychainHelper({
    operation: "upsert",
    service,
    account,
    secret,
  });
}

function readNativeSecret(service: string, account: string): string | null {
  try {
    const output = runKeychainHelper({ operation: "read", service, account });
    try {
      return output.toString();
    } finally {
      output.fill(0);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "KEYCHAIN_SECRET_NOT_FOUND"
    ) {
      return null;
    }
    throw error;
  }
}

function nativeSecretExists(service: string, account: string): boolean {
  const output = runKeychainHelper({ operation: "exists", service, account });
  try {
    const value = output.toString();
    if (value !== "0" && value !== "1") {
      throw new Error("KEYCHAIN_INVALID_RESPONSE");
    }
    return value === "1";
  } finally {
    output.fill(0);
  }
}

function deleteNativeSecret(service: string, account: string): void {
  runKeychainHelper({ operation: "delete", service, account });
}

function runKeychainHelper(request: {
  operation: "upsert" | "read" | "exists" | "delete";
  service: string;
  account: string;
  secret?: string;
}): Buffer {
  const binary = ensureKeychainHelper();
  const input = Buffer.from(
    `${request.operation}\n${request.service}\n${request.account}\n${request.secret ?? ""}`,
    "utf8",
  );
  try {
    const result = spawnSync(binary, [], {
      input,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 256 * 1024,
    });
    if (result.status !== 0) {
      const reportedCode = Buffer.from(result.stderr).toString("utf8").trim();
      result.stdout.fill(0);
      result.stderr.fill(0);
      const safeCode = /^[A-Z][A-Z0-9_]{2,63}$/.test(reportedCode)
        ? reportedCode
        : "KEYCHAIN_OPERATION_FAILED";
      throw new Error(safeCode);
    }
    const output = Buffer.from(result.stdout);
    result.stdout.fill(0);
    result.stderr.fill(0);
    return output;
  } finally {
    input.fill(0);
  }
}

function ensureKeychainHelper(): string {
  assertMacOs();
  mkdirSync(HELPER_DIRECTORY, { recursive: true, mode: 0o700 });
  chmodSync(HELPER_DIRECTORY, 0o700);

  const sourceModifiedAt = statSync(HELPER_SOURCE).mtimeMs;
  try {
    const binary = statSync(HELPER_BINARY);
    if (binary.isFile() && binary.mtimeMs >= sourceModifiedAt) {
      chmodSync(HELPER_BINARY, 0o700);
      return HELPER_BINARY;
    }
  } catch {
    // Build the local helper below.
  }

  const temporaryBinary = `${HELPER_BINARY}.${process.pid}.tmp`;
  const result = spawnSync(
    XCRUN_BINARY,
    [
      "clang",
      "-O2",
      "-framework",
      "Security",
      "-framework",
      "CoreFoundation",
      HELPER_SOURCE,
      "-o",
      temporaryBinary,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
      maxBuffer: 256 * 1024,
    },
  );
  if (result.status !== 0) {
    unlinkIfPresent(temporaryBinary);
    throw new Error("KEYCHAIN_HELPER_BUILD_FAILED");
  }
  chmodSync(temporaryBinary, 0o700);
  renameSync(temporaryBinary, HELPER_BINARY);
  chmodSync(HELPER_BINARY, 0o700);
  return HELPER_BINARY;
}

function readLegacySecret(service: string, account: string): string {
  const result = spawnSync(
    SECURITY_BINARY,
    ["find-generic-password", "-a", account, "-s", service, "-w"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024,
    },
  );
  if (result.status !== 0 || !result.stdout) {
    throw new Error("KEYCHAIN_SECRET_NOT_FOUND");
  }
  return result.stdout.replace(/[\r\n]+$/, "");
}

function legacySecretExists(service: string, account: string): boolean {
  const result = spawnSync(
    SECURITY_BINARY,
    ["find-generic-password", "-a", account, "-s", service],
    { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] },
  );
  return result.status === 0;
}

function deleteLegacySecret(service: string, account: string): void {
  spawnSync(
    SECURITY_BINARY,
    ["delete-generic-password", "-a", account, "-s", service],
    { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] },
  );
}

function unlinkIfPresent(target: string): void {
  try {
    unlinkSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
