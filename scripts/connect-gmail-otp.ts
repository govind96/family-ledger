import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { spawnSync } from "node:child_process";
import { storeGmailOAuthCredentials } from "./lib/keychain";
import { promptText } from "./lib/secure-prompt";
import { sanitizeErrorCode } from "./lib/error-code";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const PROFILE_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const CALLBACK_TIMEOUT_MS = 5 * 60_000;

type InstalledClient = {
  client_id: string;
  client_secret: string;
};

async function main() {
  const credentialsPath =
    readArgument("--credentials") ??
    (await promptText("Path to the downloaded Google Desktop OAuth JSON"));
  const client = await readInstalledClient(credentialsPath);
  const server = createServer();

  try {
    const port = await listenOnLoopback(server);
    const redirectUri = `http://127.0.0.1:${port}`;
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const authorizationUrl = new URL(AUTHORIZATION_ENDPOINT);
    authorizationUrl.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_READONLY_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();

    const codePromise = waitForAuthorizationCode(server, state);
    const opened = spawnSync("/usr/bin/open", [authorizationUrl.href], {
      stdio: "ignore",
    });
    if (opened.status !== 0) throw new Error("GMAIL_OAUTH_BROWSER_OPEN_FAILED");
    process.stdout.write(
      "A Google authorization page was opened. Approve read-only Gmail access for the dedicated OTP collector inbox.\n",
    );

    const code = await codePromise;
    const token = await exchangeAuthorizationCode({
      code,
      codeVerifier,
      redirectUri,
      client,
    });
    const email = await readGmailProfile(token.accessToken);
    storeGmailOAuthCredentials({
      clientId: client.client_id,
      clientSecret: client.client_secret,
      refreshToken: token.refreshToken,
      email,
    });
    process.stdout.write(
      "Gmail OTP collector connected. The refresh token is stored only in macOS Keychain.\n",
    );
  } finally {
    await closeServer(server);
  }
}

async function readInstalledClient(path: string): Promise<InstalledClient> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("GMAIL_OAUTH_JSON_UNREADABLE");
  }
  if (!parsed || typeof parsed !== "object" || !("installed" in parsed)) {
    throw new Error("GMAIL_DESKTOP_OAUTH_CLIENT_REQUIRED");
  }
  const installed = parsed.installed;
  if (
    !installed ||
    typeof installed !== "object" ||
    !("client_id" in installed) ||
    !("client_secret" in installed) ||
    typeof installed.client_id !== "string" ||
    typeof installed.client_secret !== "string" ||
    !installed.client_id.endsWith(".apps.googleusercontent.com") ||
    /[\0\r\n]/.test(installed.client_secret)
  ) {
    throw new Error("GMAIL_DESKTOP_OAUTH_CLIENT_INVALID");
  }
  return {
    client_id: installed.client_id,
    client_secret: installed.client_secret,
  };
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("GMAIL_OAUTH_CALLBACK_BIND_FAILED"));
        return;
      }
      resolve(address.port);
    });
  });
}

function waitForAuthorizationCode(server: Server, expectedState: string) {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("GMAIL_OAUTH_CALLBACK_TIMED_OUT"));
    }, CALLBACK_TIMEOUT_MS);

    server.on("request", (request, response) => {
      const remoteAddress = request.socket.remoteAddress;
      if (
        remoteAddress !== "127.0.0.1" &&
        remoteAddress !== "::1" &&
        remoteAddress !== "::ffff:127.0.0.1"
      ) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error");
      if (state !== expectedState) {
        response.writeHead(400).end("Invalid authorization state");
        return;
      }
      if (oauthError || !code) {
        clearTimeout(timeout);
        response.writeHead(400).end("Authorization was not completed");
        reject(new Error("GMAIL_OAUTH_ACCESS_NOT_GRANTED"));
        return;
      }

      clearTimeout(timeout);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
      });
      response.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>Gmail connected</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f5f1;color:#173329;font:16px system-ui}.card{max-width:440px;padding:36px;border:1px solid #d8e3dc;border-radius:20px;background:white;box-shadow:0 18px 50px #17332918}h1{margin:0 0 10px;font-size:24px}p{margin:0;color:#66756e;line-height:1.5}</style></head><body><main class="card"><h1>Gmail connected</h1><p>You can close this tab and return to Family Ledger.</p></main></body></html>',
      );
      resolve(code);
    });
  });
}

async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  client: InstalledClient;
}): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.client.client_id,
      client_secret: input.client.client_secret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object") {
    throw new Error("GMAIL_OAUTH_TOKEN_EXCHANGE_FAILED");
  }
  const accessToken = "access_token" in body ? body.access_token : null;
  const refreshToken = "refresh_token" in body ? body.refresh_token : null;
  const scope = "scope" in body ? body.scope : null;
  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof scope !== "string" ||
    !scope.split(/\s+/).includes(GMAIL_READONLY_SCOPE)
  ) {
    throw new Error("GMAIL_READONLY_SCOPE_NOT_GRANTED");
  }
  return { accessToken, refreshToken };
}

async function readGmailProfile(accessToken: string): Promise<string> {
  const response = await fetch(PROFILE_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await response.json().catch(() => null);
  const email =
    body && typeof body === "object" && "emailAddress" in body
      ? body.emailAddress
      : null;
  if (!response.ok || typeof email !== "string") {
    throw new Error("GMAIL_PROFILE_READ_FAILED");
  }
  return email;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function readArgument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? "";
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Gmail connection failed: ${sanitizeErrorCode(error)}\n`,
  );
  process.exitCode = 1;
});
