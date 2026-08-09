import { signIngestionBody } from "@/lib/security/hmac";
import { readIngestionSecret } from "./lib/keychain";
import { secureRandomHex } from "./lib/random";

async function main() {
  const endpoint =
    process.env.SMOKE_INGEST_URL ??
    "http://localhost:3000/api/sync/ingest";
  const endpointUrl = new URL(endpoint);
  const isLoopback =
    endpointUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(endpointUrl.hostname);
  const secret =
    process.env.SMOKE_INGEST_SECRET ??
    (isLoopback ? readIngestionSecret() : undefined);
  if (!secret || secret.length < 32) {
    throw new Error("SMOKE_INGEST_SECRET_REQUIRED");
  }

  if (!process.argv.includes("--commit")) {
    const body = "{}";
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = secureRandomHex(24);
    const signature = await signIngestionBody({
      body,
      nonce,
      secret,
      timestamp,
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sync-timestamp": String(timestamp),
        "x-sync-nonce": nonce,
        "x-sync-signature": signature,
      },
      body,
    });
    const result = (await response.json()) as { error?: string };
    if (response.status !== 422 || result.error !== "INVALID_PAYLOAD") {
      throw new Error(
        `INGESTION_CHECK_FAILED:${result.error ?? response.status}`,
      );
    }
    process.stdout.write(
      "Signed local ingestion configuration verified. No snapshot was written.\n",
    );
    return;
  }

  const now = new Date();
  const payload = {
    syncId: crypto.randomUUID(),
    account: {
      id: "00000000-0000-4000-8000-000000000099",
      ownerLabel: "Synthetic smoke test",
      accountLabel: "Non-production fixture",
      brokerLabel: "Example DP",
      depository: "CDSL",
      boidLast4: "0000",
      viewRightsVerifiedAt: now.toISOString(),
    },
    snapshot: {
      startedAt: new Date(now.getTime() - 5_000).toISOString(),
      completedAt: now.toISOString(),
      sourceAsOfDate: "2026-08-08",
      priceDate: "2026-08-07",
      sourceTotalValue: "1234.56",
      parserVersion: "smoke-v1",
      pageSignature: "a".repeat(64),
      holdings: [
        {
          isin: "INE002A01018",
          securityName: "Synthetic Security Limited",
          listingStatus: "Listed",
          paidUpValue: "10",
          quantity: "12",
          lastClosingPrice: "102.88",
          holdingValue: "1234.56",
        },
      ],
    },
  };
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = secureRandomHex(24);
  const signature = await signIngestionBody({ body, nonce, secret, timestamp });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sync-timestamp": String(timestamp),
      "x-sync-nonce": nonce,
      "x-sync-signature": signature,
    },
    body,
  });
  const result = (await response.json()) as { ok?: boolean; error?: string };
  if (response.status !== 201 || result.ok !== true) {
    throw new Error(`SMOKE_INGEST_FAILED:${result.error ?? response.status}`);
  }
  process.stdout.write("Signed synthetic snapshot accepted and committed.\n");

  const replay = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sync-timestamp": String(timestamp),
      "x-sync-nonce": nonce,
      "x-sync-signature": signature,
    },
    body,
  });
  const replayResult = (await replay.json()) as { error?: string };
  if (replay.status !== 409 || replayResult.error !== "REPLAY_DETECTED") {
    throw new Error("REPLAY_PROTECTION_FAILED");
  }
  process.stdout.write("Replay attempt rejected.\n");
}

main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "SMOKE_TEST_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
