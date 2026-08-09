const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_BODY_BYTES = 1_000_000;

export type SignatureCheck =
  | { ok: true; timestamp: number; nonce: string }
  | { ok: false; status: number; code: string };

export async function verifyIngestionSignature(input: {
  body: string;
  headers: Headers;
  secret: string | undefined;
  nowSeconds?: number;
}): Promise<SignatureCheck> {
  const { body, headers, secret } = input;
  if (!secret || secret.length < 32) {
    return { ok: false, status: 503, code: "INGESTION_NOT_CONFIGURED" };
  }

  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: "PAYLOAD_TOO_LARGE" };
  }

  const timestampHeader = headers.get("x-sync-timestamp") ?? "";
  const nonce = headers.get("x-sync-nonce") ?? "";
  const signature = (headers.get("x-sync-signature") ?? "").toLowerCase();
  const timestamp = Number(timestampHeader);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!Number.isSafeInteger(timestamp)) {
    return { ok: false, status: 401, code: "INVALID_SIGNATURE" };
  }
  if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 401, code: "EXPIRED_SIGNATURE" };
  }
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(nonce)) {
    return { ok: false, status: 401, code: "INVALID_SIGNATURE" };
  }
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    return { ok: false, status: 401, code: "INVALID_SIGNATURE" };
  }

  const expected = await signIngestionBody({
    body,
    nonce,
    secret,
    timestamp,
  });

  if (!constantTimeHexEqual(expected, signature)) {
    return { ok: false, status: 401, code: "INVALID_SIGNATURE" };
  }

  return { ok: true, timestamp, nonce };
}

export async function signIngestionBody(input: {
  body: string;
  nonce: string;
  secret: string;
  timestamp: number;
}): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = `${input.timestamp}.${input.nonce}.${input.body}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  return bytesToHex(new Uint8Array(signature));
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
