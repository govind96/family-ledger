import {
  readAccountConfig,
  writeAccountConfig,
  type LocalAccount,
} from "./account-config";
import {
  assertValidCdslCredentials,
  deleteCdslCredentials,
  storeCdslCredentials,
  type CdslCredentials,
} from "./keychain";

export type NewCdslAccount = {
  ownerLabel?: string;
  accountLabel?: string;
  brokerLabel?: string;
  boidLast4?: string;
  ownerConsented: boolean;
  credentials: CdslCredentials;
};

export async function addLocalCdslAccount(
  input: NewCdslAccount,
): Promise<LocalAccount> {
  if (!input.ownerConsented) throw new Error("OWNER_CONSENT_REQUIRED");
  const ownerLabel =
    validateOptionalLabel(input.ownerLabel, "INVALID_OWNER_LABEL") ||
    "Family member";
  const accountLabel =
    validateOptionalLabel(
    input.accountLabel,
    "INVALID_ACCOUNT_LABEL",
  ) || "CDSL account";
  const brokerLabel =
    validateOptionalLabel(
    input.brokerLabel,
    "INVALID_BROKER_LABEL",
  ) || "CDSL";
  const boidLast4 = input.boidLast4?.trim() ?? "";
  if (boidLast4 && !/^\d{4}$/.test(boidLast4)) {
    throw new Error("INVALID_BOID_LAST4");
  }
  assertValidCdslCredentials(input.credentials);

  const config = await readAccountConfig();
  const account: LocalAccount = {
    id: crypto.randomUUID(),
    ownerLabel,
    accountLabel,
    brokerLabel,
    boidLast4,
    consentedAt: new Date().toISOString(),
    enabled: true,
  };
  storeCdslCredentials(account.id, input.credentials);
  try {
    await writeAccountConfig({
      ...config,
      accounts: [...config.accounts, account],
    });
  } catch (error) {
    deleteCdslCredentials(account.id);
    throw error;
  }
  return account;
}

export async function updateLocalCdslCredentials(
  accountReference: string,
  credentials: CdslCredentials,
): Promise<LocalAccount> {
  assertValidCdslCredentials(credentials);
  const config = await readAccountConfig();
  const account = resolveAccountReference(config.accounts, accountReference);
  storeCdslCredentials(account.id, credentials);
  return account;
}

export function resolveAccountReference(
  accounts: LocalAccount[],
  reference: string,
): LocalAccount {
  const normalized = reference.trim();
  if (!normalized) throw new Error("ACCOUNT_REFERENCE_REQUIRED");
  const matches = accounts.filter((account) =>
    account.id.startsWith(normalized),
  );
  if (matches.length !== 1) throw new Error("ACCOUNT_REFERENCE_NOT_UNIQUE");
  return matches[0];
}

function validateOptionalLabel(value: string | undefined, errorCode: string): string {
  const normalized = value?.trim() ?? "";
  if (
    normalized.length > 80 ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error(errorCode);
  }
  return normalized;
}
