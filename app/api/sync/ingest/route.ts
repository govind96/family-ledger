import { getEnvironment } from "@/db/runtime";
import { persistSuccessfulIngestion } from "@/lib/ingestion-store";
import {
  ingestionSchema,
  validateSnapshotConsistency,
} from "@/lib/ingestion-schema";
import { verifyIngestionSignature } from "@/lib/security/hmac";

export async function POST(request: Request) {
  const declaredLengthHeader = request.headers.get("content-length");
  const declaredLength = declaredLengthHeader
    ? Number(declaredLengthHeader)
    : null;
  if (
    declaredLength !== null &&
    (!Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > 1_000_000)
  ) {
    return errorResponse(413, "PAYLOAD_TOO_LARGE");
  }

  let body: string | null;
  try {
    body = await readRequestBody(request, 1_000_000);
  } catch {
    return errorResponse(400, "INVALID_BODY_ENCODING");
  }
  if (body === null) return errorResponse(413, "PAYLOAD_TOO_LARGE");
  const environment = getEnvironment();
  const signature = await verifyIngestionSignature({
    body,
    headers: request.headers,
    secret:
      environment.INGESTION_HMAC_SECRET ??
      process.env.INGESTION_HMAC_SECRET,
  });
  if (!signature.ok) {
    return errorResponse(signature.status, signature.code);
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return errorResponse(400, "INVALID_JSON");
  }

  const parsed = ingestionSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(422, "INVALID_PAYLOAD");
  }

  let normalizedTotalValue: string;
  try {
    ({ normalizedTotalValue } = validateSnapshotConsistency(parsed.data));
  } catch (error) {
    const code =
      error instanceof Error &&
      ["DUPLICATE_ISIN", "TOTAL_RECONCILIATION_FAILED"].includes(error.message)
        ? error.message
        : "RECONCILIATION_FAILED";
    return errorResponse(422, code);
  }

  try {
    await persistSuccessfulIngestion({
      payload: parsed.data,
      normalizedTotalValue,
      nonce: signature.nonce,
      actor: "local-cdsl-worker",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed: ingest_nonces.nonce")) {
      return errorResponse(409, "REPLAY_DETECTED");
    }
    if (message.includes("UNIQUE constraint failed: sync_runs.id")) {
      return errorResponse(409, "SYNC_ALREADY_EXISTS");
    }
    return errorResponse(500, "PERSISTENCE_FAILED");
  }

  return Response.json(
    {
      ok: true,
      syncId: parsed.data.syncId,
      rowsAccepted: parsed.data.snapshot.holdings.length,
    },
    { status: 201, headers: securityHeaders() },
  );
}

async function readRequestBody(
  request: Request,
  limitBytes: number,
): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limitBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

function errorResponse(status: number, code: string): Response {
  return Response.json(
    { ok: false, error: code },
    { status, headers: securityHeaders() },
  );
}

function securityHeaders(): HeadersInit {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'",
    "x-content-type-options": "nosniff",
  };
}
