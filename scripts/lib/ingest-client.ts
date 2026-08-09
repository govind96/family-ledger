import { signIngestionBody } from "@/lib/security/hmac";
import type { ExtractedSnapshot } from "./cdsl-connector";
import { secureRandomHex } from "./random";

export async function ingestSnapshot(input: {
  snapshot: ExtractedSnapshot;
  endpoint: string;
  secret: string;
  accessClientId?: string;
  accessClientSecret?: string;
}): Promise<string> {
  const endpoint = new URL(input.endpoint);
  const localHttp =
    endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !localHttp) {
    throw new Error("INSECURE_INGESTION_ENDPOINT");
  }

  const payload = {
    syncId: crypto.randomUUID(),
    account: {
      id: input.snapshot.account.id,
      ownerLabel: input.snapshot.account.ownerLabel,
      accountLabel: input.snapshot.account.accountLabel,
      brokerLabel: input.snapshot.account.brokerLabel,
      depository: "CDSL" as const,
      boidLast4: input.snapshot.account.boidLast4,
      viewRightsVerifiedAt: input.snapshot.completedAt,
    },
    snapshot: {
      startedAt: input.snapshot.startedAt,
      completedAt: input.snapshot.completedAt,
      sourceAsOfDate: input.snapshot.sourceAsOfDate,
      priceDate: input.snapshot.priceDate,
      sourceTotalValue: input.snapshot.sourceTotalValue,
      parserVersion: input.snapshot.parserVersion,
      pageSignature: input.snapshot.pageSignature,
      holdings: input.snapshot.holdings,
    },
  };
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = secureRandomHex(24);
  const signature = await signIngestionBody({
    body,
    nonce,
    secret: input.secret,
    timestamp,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "content-type": "application/json",
      "x-sync-timestamp": String(timestamp),
      "x-sync-nonce": nonce,
      "x-sync-signature": signature,
      ...(input.accessClientId && input.accessClientSecret
        ? {
            "cf-access-client-id": input.accessClientId,
            "cf-access-client-secret": input.accessClientSecret,
          }
        : {}),
    },
    body,
  });

  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    try {
      const result = (await response.json()) as { error?: string };
      if (result.error && /^[A-Z0-9_]+$/.test(result.error)) code = result.error;
    } catch {
      // Deliberately ignore untrusted response bodies.
    }
    throw new Error(`INGESTION_FAILED:${code}`);
  }
  return payload.syncId;
}
