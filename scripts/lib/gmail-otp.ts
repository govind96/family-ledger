import {
  gmailOAuthCredentialsExist,
  readGmailOAuthCredentials,
  type GmailOAuthCredentials,
} from "./keychain";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_API_ROOT = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_OTP_QUERY = "newer_than:1d CDSL";
const OTP_WAIT_TIMEOUT_MS = 4 * 60_000;
const OTP_POLL_INTERVAL_MS = 2_000;
const MESSAGE_CLOCK_SKEW_MS = 15_000;
const MAX_MESSAGE_TEXT_BYTES = 256 * 1024;

type GmailMessageList = {
  messages?: Array<{ id?: string }>;
};

type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
  headers?: Array<{ name?: string; value?: string }>;
};

type GmailMessage = {
  id?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
};

export type GmailOtpAttempt = Readonly<{
  startedAt: number;
  baselineMessageIds: ReadonlySet<string>;
}>;

export class GmailOtpReader {
  readonly #credentials: GmailOAuthCredentials;
  readonly #consumedMessageIds = new Set<string>();
  #accessToken: string | null = null;
  #accessTokenExpiresAt = 0;

  constructor() {
    this.#credentials = readGmailOAuthCredentials();
  }

  async beginAttempt(): Promise<GmailOtpAttempt> {
    const baselineMessageIds = new Set(await this.#listMatchingMessageIds());
    return { startedAt: Date.now(), baselineMessageIds };
  }

  async waitForOtp(attempt: GmailOtpAttempt): Promise<string> {
    const deadline = Date.now() + OTP_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const ids = await this.#listMatchingMessageIds();
      for (const id of ids) {
        if (
          attempt.baselineMessageIds.has(id) ||
          this.#consumedMessageIds.has(id)
        ) {
          continue;
        }
        const message = await this.#readMessage(id);
        const internalDate = Number(message.internalDate);
        if (
          !Number.isFinite(internalDate) ||
          internalDate < attempt.startedAt - MESSAGE_CLOCK_SKEW_MS
        ) {
          continue;
        }
        const text = messageText(message);
        const otp = extractOtpFromText(text);
        if (!otp) continue;
        this.#consumedMessageIds.add(id);
        return otp;
      }
      await new Promise((resolve) => setTimeout(resolve, OTP_POLL_INTERVAL_MS));
    }
    throw new Error("GMAIL_OTP_TIMED_OUT");
  }

  clearSecrets(): void {
    this.#accessToken = null;
    this.#accessTokenExpiresAt = 0;
    this.#credentials.clientSecret = "";
    this.#credentials.refreshToken = "";
  }

  async #listMatchingMessageIds(): Promise<string[]> {
    const url = new URL(`${GMAIL_API_ROOT}/messages`);
    url.searchParams.set("q", GMAIL_OTP_QUERY);
    url.searchParams.set("maxResults", "20");
    const body = await this.#requestJson<GmailMessageList>(url);
    return (body.messages ?? [])
      .map((message) => message.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  async #readMessage(id: string): Promise<GmailMessage> {
    if (!/^[A-Za-z0-9_-]{5,128}$/.test(id)) {
      throw new Error("GMAIL_MESSAGE_ID_INVALID");
    }
    const url = new URL(`${GMAIL_API_ROOT}/messages/${id}`);
    url.searchParams.set("format", "full");
    return this.#requestJson<GmailMessage>(url);
  }

  async #requestJson<T>(url: URL): Promise<T> {
    const accessToken = await this.#getAccessToken();
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      if (response.status === 401) {
        this.#accessToken = null;
        this.#accessTokenExpiresAt = 0;
      }
      throw new Error("GMAIL_API_REQUEST_FAILED");
    }
    return (await response.json()) as T;
  }

  async #getAccessToken(): Promise<string> {
    if (this.#accessToken && this.#accessTokenExpiresAt > Date.now() + 30_000) {
      return this.#accessToken;
    }
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.#credentials.clientId,
        client_secret: this.#credentials.clientSecret,
        refresh_token: this.#credentials.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== "object") {
      throw new Error(
        response.status === 400
          ? "GMAIL_OAUTH_REAUTH_REQUIRED"
          : "GMAIL_OAUTH_REFRESH_FAILED",
      );
    }
    const accessToken = "access_token" in body ? body.access_token : null;
    const expiresIn = "expires_in" in body ? body.expires_in : null;
    if (
      typeof accessToken !== "string" ||
      typeof expiresIn !== "number" ||
      expiresIn < 60 ||
      expiresIn > 86_400
    ) {
      throw new Error("GMAIL_OAUTH_REFRESH_RESPONSE_INVALID");
    }
    this.#accessToken = accessToken;
    this.#accessTokenExpiresAt = Date.now() + expiresIn * 1000;
    return accessToken;
  }
}

export function gmailOtpIsConfigured(): boolean {
  return gmailOAuthCredentialsExist();
}

export function extractOtpFromText(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ");
  const patterns = [
    /(?:one[ -]?time password|otp|verification code|security code)[^0-9]{0,80}([0-9]{4,8})/gi,
    /([0-9]{4,8})[^a-z0-9]{0,24}(?:is )?(?:your )?(?:one[ -]?time password|otp|verification code|security code)/gi,
  ];
  const candidates = new Set<string>();
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      if (match[1]) candidates.add(match[1]);
    }
  }
  if (candidates.size > 1) throw new Error("GMAIL_OTP_AMBIGUOUS");
  return candidates.values().next().value ?? null;
}

function messageText(message: GmailMessage): string {
  if (!message.payload) throw new Error("GMAIL_MESSAGE_PAYLOAD_MISSING");
  const headers = (message.payload.headers ?? [])
    .filter((header) => /^(?:subject|from|to)$/i.test(header.name ?? ""))
    .map((header) => `${header.name ?? ""}: ${header.value ?? ""}`);
  const bodyParts: string[] = [];
  collectTextParts(message.payload, bodyParts);
  const combined = [...headers, ...bodyParts].join("\n");
  if (Buffer.byteLength(combined, "utf8") > MAX_MESSAGE_TEXT_BYTES) {
    throw new Error("GMAIL_OTP_MESSAGE_TOO_LARGE");
  }
  return decodeHtmlText(combined);
}

function collectTextParts(part: GmailMessagePart, output: string[]): void {
  const mimeType = (part.mimeType ?? "").toLowerCase();
  if (
    part.body?.data &&
    (mimeType === "text/plain" || mimeType === "text/html")
  ) {
    output.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
  }
  for (const child of part.parts ?? []) collectTextParts(child, output);
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}
