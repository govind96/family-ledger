import { randomBytes, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  addLocalCdslAccount,
  resolveAccountReference,
  updateLocalCdslCredentials,
} from "./account-management";
import { readAccountConfig } from "./account-config";

const MAX_FORM_BYTES = 16 * 1024;

export type AccountOnboardingServer = {
  url: string;
  close: () => Promise<void>;
};

export async function startAccountOnboardingServer(options?: {
  dashboardUrl?: string;
}): Promise<AccountOnboardingServer> {
  const token = Buffer.from(randomBytes(32)).toString("base64url");
  const formToken = Buffer.from(randomBytes(32)).toString("base64url");
  const basePath = `/local-account-setup/${token}`;
  let origin = "";
  const dashboardUrl = safeDashboardUrl(options?.dashboardUrl);

  const server = createServer((request, response) => {
    void handleRequest({
      request,
      response,
      origin,
      basePath,
      formToken,
      dashboardUrl,
    }).catch(() => {
      if (!response.headersSent) {
        sendHtml(response, 500, renderMessagePage({
          title: "Account setup stopped safely",
          body: "The local setup service could not complete that request. No dashboard snapshot was changed.",
          basePath,
          dashboardUrl,
        }));
      } else {
        response.destroy();
      }
    });
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 2_000;

  await listenOnLoopback(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("ACCOUNT_UI_BIND_FAILED");
  }
  origin = `http://127.0.0.1:${address.port}`;

  return {
    url: `${origin}${basePath}`,
    close: () => closeServer(server),
  };
}

async function handleRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  origin: string;
  basePath: string;
  formToken: string;
  dashboardUrl: string | null;
}): Promise<void> {
  const { request, response, origin, basePath, formToken, dashboardUrl } = input;
  if (!origin || !isLoopbackRequest(request, origin)) {
    sendPlain(response, 421, "LOOPBACK_REQUEST_REQUIRED");
    return;
  }

  const requestUrl = new URL(request.url ?? "/", origin);
  if (request.method === "GET" && requestUrl.pathname === basePath) {
    const config = await readAccountConfig();
    sendHtml(
      response,
      200,
      renderAddAccountPage({
        basePath,
        formToken,
        dashboardUrl,
        accounts: config.accounts,
      }),
    );
    return;
  }

  const credentialPathPrefix = `${basePath}/credentials/`;
  if (
    request.method === "GET" &&
    requestUrl.pathname.startsWith(credentialPathPrefix)
  ) {
    const accountId = decodeAccountId(
      requestUrl.pathname.slice(credentialPathPrefix.length),
    );
    const config = await readAccountConfig();
    const account = resolveAccountReference(config.accounts, accountId);
    sendHtml(
      response,
      200,
      renderCredentialUpdatePage({ basePath, formToken, dashboardUrl, account }),
    );
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === `${basePath}/accounts`) {
    if (!isAllowedFormOrigin(request, origin)) {
      sendPlain(response, 403, "INVALID_FORM_ORIGIN");
      return;
    }
    const form = await readForm(request);
    let username = "";
    let password = "";
    try {
      assertOnlyFields(form, [
        "ownerLabel",
        "accountLabel",
        "brokerLabel",
        "boidLast4",
        "username",
        "password",
        "ownerConsented",
        "formToken",
      ]);
      requireFormToken(form, formToken);
      username = requiredField(form, "username");
      password = requiredField(form, "password");
      const account = await addLocalCdslAccount({
        ownerLabel: optionalField(form, "ownerLabel"),
        accountLabel: optionalField(form, "accountLabel"),
        brokerLabel: optionalField(form, "brokerLabel"),
        boidLast4: optionalField(form, "boidLast4"),
        ownerConsented: requiredField(form, "ownerConsented") === "yes",
        credentials: { username, password },
      });
      sendHtml(
        response,
        201,
        renderMessagePage({
          title: "Account added securely",
          body: `${account.accountLabel} is ready for its first controlled CDSL synchronization. Local reference: ${account.id.slice(0, 8)}.`,
          basePath,
          dashboardUrl,
        }),
      );
    } catch (error) {
      sendHtml(
        response,
        400,
        renderMessagePage({
          title: "Check the account details",
          body: friendlyAccountError(error),
          basePath,
          dashboardUrl,
        }),
      );
    } finally {
      username = "";
      password = "";
      form.set("username", "");
      form.set("password", "");
    }
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname.startsWith(credentialPathPrefix)
  ) {
    if (!isAllowedFormOrigin(request, origin)) {
      sendPlain(response, 403, "INVALID_FORM_ORIGIN");
      return;
    }
    const accountId = decodeAccountId(
      requestUrl.pathname.slice(credentialPathPrefix.length),
    );
    const form = await readForm(request);
    let username = "";
    let password = "";
    try {
      assertOnlyFields(form, ["username", "password", "formToken"]);
      requireFormToken(form, formToken);
      username = requiredField(form, "username");
      password = requiredField(form, "password");
      const account = await updateLocalCdslCredentials(accountId, {
        username,
        password,
      });
      sendHtml(
        response,
        200,
        renderMessagePage({
          title: "Credentials updated",
          body: `${account.accountLabel} will use the new CDSL login on its next synchronization.`,
          basePath,
          dashboardUrl,
        }),
      );
    } catch (error) {
      sendHtml(
        response,
        400,
        renderMessagePage({
          title: "Credentials were not changed",
          body: friendlyAccountError(error),
          basePath,
          dashboardUrl,
        }),
      );
    } finally {
      username = "";
      password = "";
      form.set("username", "");
      form.set("password", "");
    }
    return;
  }

  sendPlain(response, 404, "NOT_FOUND");
}

function renderAddAccountPage(input: {
  basePath: string;
  formToken: string;
  dashboardUrl: string | null;
  accounts: Awaited<ReturnType<typeof readAccountConfig>>["accounts"];
}): string {
  const accountList = input.accounts.length
    ? input.accounts
        .map(
          (account) => `
            <li>
              <div><strong>${escapeHtml(account.ownerLabel)}</strong><span>${escapeHtml(account.accountLabel)} · ${escapeHtml(account.brokerLabel)}${account.boidLast4 ? ` · •••• ${escapeHtml(account.boidLast4)}` : ""}</span></div>
              <a href="${input.basePath}/credentials/${encodeURIComponent(account.id)}">Update login</a>
            </li>`,
        )
        .join("")
    : "<li class=\"empty-account\">No local accounts have been added yet.</li>";

  return pageShell({
    title: "Add a CDSL EASI account",
    eyebrow: "Local account setup",
    body: `
      <div class="layout">
        <section class="card form-card">
          <p class="intro">Add an owner-authorized, view-only account. Credentials go directly from this loopback form to macOS Keychain and never enter the dashboard or database.</p>
          <form method="post" action="${input.basePath}/accounts" autocomplete="off">
            <input type="hidden" name="formToken" value="${input.formToken}">
            <div class="field-grid">
              ${textField("ownerLabel", "Owner display name (optional)", "Defaults to Family member", 80, undefined, undefined, false)}
              ${textField("accountLabel", "Account nickname (optional)", "Defaults to CDSL account", 80, undefined, undefined, false)}
              ${textField("brokerLabel", "Broker / DP label (optional)", "Defaults to CDSL", 80, undefined, undefined, false)}
              ${textField("boidLast4", "Last four digits of CDSL BO ID (optional)", "Not stored unless entered", 4, "[0-9]{4}", "numeric", false)}
              ${textField("username", "CDSL EASI username", "6–16 letters, digits or underscore", 16, "[A-Za-z0-9_]{6,16}")}
              ${passwordField()}
            </div>
            <label class="consent"><input type="checkbox" name="ownerConsented" value="yes" required><span>The account holder approved daily view-only holdings access.</span></label>
            <div class="assurance"><span>View-only EASI</span><span>No PAN stored</span><span>No trading controls</span></div>
            <button type="submit">Store account securely</button>
          </form>
        </section>
        <aside class="card accounts-card">
          <p class="section-label">Configured accounts</p>
          <ul>${accountList}</ul>
        </aside>
      </div>`,
    dashboardUrl: input.dashboardUrl,
  });
}

function renderCredentialUpdatePage(input: {
  basePath: string;
  formToken: string;
  dashboardUrl: string | null;
  account: Awaited<ReturnType<typeof readAccountConfig>>["accounts"][number];
}): string {
  const action = `${input.basePath}/credentials/${encodeURIComponent(input.account.id)}`;
  return pageShell({
    title: "Update CDSL login",
    eyebrow: "Credential repair",
    body: `
      <section class="card form-card narrow">
        <p class="intro">Replace the Keychain credentials for <strong>${escapeHtml(input.account.ownerLabel)} / ${escapeHtml(input.account.accountLabel)}</strong>. The account reference and existing holdings history stay unchanged.</p>
        <form method="post" action="${action}" autocomplete="off">
          <input type="hidden" name="formToken" value="${input.formToken}">
          <div class="field-grid single">
            ${textField("username", "CDSL EASI username", "6–16 letters, digits or underscore", 16, "[A-Za-z0-9_]{6,16}")}
            ${passwordField()}
          </div>
          <div class="assurance"><span>Old values replaced</span><span>History preserved</span><span>Keychain only</span></div>
          <button type="submit">Update credentials</button>
          <a class="text-link" href="${input.basePath}">Cancel and return</a>
        </form>
      </section>`,
    dashboardUrl: input.dashboardUrl,
  });
}

function renderMessagePage(input: {
  title: string;
  body: string;
  basePath: string;
  dashboardUrl: string | null;
}): string {
  return pageShell({
    title: input.title,
    eyebrow: "Local account setup",
    body: `
      <section class="card message-card">
        <p class="intro">${escapeHtml(input.body)}</p>
        <div class="message-actions">
          <a class="button-link" href="${input.basePath}">Back to account setup</a>
          ${input.dashboardUrl ? `<a class="text-link" href="${escapeHtml(input.dashboardUrl)}">Return to dashboard</a>` : ""}
        </div>
      </section>`,
    dashboardUrl: input.dashboardUrl,
  });
}

function pageShell(input: {
  title: string;
  eyebrow: string;
  body: string;
  dashboardUrl: string | null;
}): string {
  return `<!doctype html>
<html lang="en-IN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(input.title)} — Family Ledger</title>
  <style>
    :root{--paper:#f3f1eb;--surface:#fff;--ink:#17231f;--muted:#68716d;--line:#dedfd9;--green:#0d6b50;--soft:#e4f1ea}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 82% 0%,rgba(38,116,84,.08),transparent 28rem),var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.topbar{height:72px;padding:0 clamp(18px,5vw,64px);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(23,35,31,.1);background:rgba(251,250,247,.82)}.brand{display:flex;align-items:center;gap:11px;font-size:14px;font-weight:750}.mark{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;background:var(--ink);color:#fff}.local{padding:7px 10px;border:1px solid rgba(13,107,80,.14);border-radius:99px;background:var(--soft);color:var(--green);font-size:11px;font-weight:700}.shell{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:48px 0}.eyebrow{margin:0;color:var(--green);font-size:11px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}h1{margin:9px 0 30px;font-family:Georgia,serif;font-size:clamp(34px,5vw,52px);font-weight:500;letter-spacing:-.045em}.layout{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.75fr);gap:16px}.card{border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.94);box-shadow:0 18px 48px rgba(31,42,36,.07)}.form-card{padding:clamp(22px,4vw,36px)}.form-card.narrow,.message-card{max-width:690px;padding:36px}.intro{margin:0 0 26px;color:var(--muted);font-size:13px;line-height:1.65}.intro strong{color:var(--ink)}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px 16px}.field-grid.single{grid-template-columns:1fr}.field{display:grid;gap:7px}.field span,.section-label{color:#57625d;font-size:11px;font-weight:680}.field input{width:100%;height:44px;padding:0 12px;border:1px solid #d8dcd6;border-radius:10px;background:#fbfcfa;color:var(--ink);font:inherit;font-size:13px}.field input:focus{outline:3px solid rgba(13,107,80,.16);border-color:var(--green)}.consent{margin:22px 0 0;display:flex;align-items:flex-start;gap:9px;color:#57625d;font-size:11px;line-height:1.45}.consent input{margin-top:2px;accent-color:var(--green)}.assurance{margin:22px 0;display:flex;flex-wrap:wrap;gap:7px}.assurance span{padding:6px 9px;border-radius:99px;background:#f1f4f0;color:#65706b;font-size:9px;font-weight:650}.assurance span:before{content:"";display:inline-block;width:5px;height:5px;margin-right:6px;border-radius:50%;background:var(--green);vertical-align:1px}button,.button-link{min-height:44px;padding:0 17px;border:0;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;background:var(--green);color:#fff;font:inherit;font-size:12px;font-weight:720;text-decoration:none;cursor:pointer;box-shadow:0 8px 18px rgba(13,107,80,.17)}.accounts-card{padding:24px}.section-label{margin:0 0 13px}.accounts-card ul{list-style:none;margin:0;padding:0;display:grid;gap:8px;max-height:470px;overflow:auto}.accounts-card li{padding:12px;border:1px solid #e8eae6;border-radius:11px;background:#fbfcfa;display:flex;align-items:center;justify-content:space-between;gap:10px}.accounts-card strong,.accounts-card span{display:block}.accounts-card strong{font-size:11px}.accounts-card span{margin-top:4px;color:#8a918e;font-size:9px}.accounts-card a,.text-link{color:var(--green);font-size:10px;font-weight:700;text-decoration:none;white-space:nowrap}.empty-account{color:var(--muted);font-size:11px}.text-link{display:inline-flex;margin:15px 0 0 14px}.message-actions{display:flex;align-items:center;gap:6px}.message-actions .text-link{margin:0 0 0 12px}.footer{margin-top:28px;color:#858d89;font-size:10px}.footer a{color:var(--green);text-decoration:none}@media(max-width:780px){.layout,.field-grid{grid-template-columns:1fr}.shell{padding-top:32px}.topbar{height:64px}.local{display:none}.form-card.narrow,.message-card{padding:26px}.message-actions{align-items:flex-start;flex-direction:column}.message-actions .text-link{margin:12px 0 0}}
  </style>
</head>
<body>
  <header class="topbar"><div class="brand"><span class="mark">FL</span><span>Family Ledger</span></div><span class="local">Loopback-only setup</span></header>
  <main class="shell"><p class="eyebrow">${escapeHtml(input.eyebrow)}</p><h1>${escapeHtml(input.title)}</h1>${input.body}<p class="footer">This temporary setup page is available only on this Mac. ${input.dashboardUrl ? `<a href="${escapeHtml(input.dashboardUrl)}">Dashboard</a>` : "Close the tab when finished."}</p></main>
</body>
</html>`;
}

function textField(
  name: string,
  label: string,
  placeholder: string,
  maxLength: number,
  pattern?: string,
  inputMode?: string,
  required = true,
): string {
  return `<label class="field"><span>${escapeHtml(label)}</span><input type="text" name="${name}" placeholder="${escapeHtml(placeholder)}" maxlength="${maxLength}"${pattern ? ` pattern="${pattern}"` : ""}${inputMode ? ` inputmode="${inputMode}"` : ""} autocomplete="off" autocapitalize="off" spellcheck="false"${required ? " required" : ""}></label>`;
}

function passwordField(): string {
  return '<label class="field"><span>CDSL EASI password</span><input type="password" name="password" placeholder="Stored in macOS Keychain" minlength="6" maxlength="16" autocomplete="new-password" autocapitalize="off" spellcheck="false" required></label>';
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    throw new Error("INVALID_FORM_CONTENT_TYPE");
  }
  const declaredLength = Number(request.headers["content-length"] ?? "0");
  if (
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_FORM_BYTES
  ) {
    throw new Error("ACCOUNT_FORM_TOO_LARGE");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_FORM_BYTES) throw new Error("ACCOUNT_FORM_TOO_LARGE");
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks, total);
  try {
    return new URLSearchParams(body.toString("utf8"));
  } finally {
    body.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

function isAllowedFormOrigin(request: IncomingMessage, origin: string): boolean {
  const suppliedOrigin = request.headers.origin;
  if (
    suppliedOrigin &&
    suppliedOrigin !== "null" &&
    suppliedOrigin !== origin
  ) {
    return false;
  }
  const fetchSite = request.headers["sec-fetch-site"];
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function requireFormToken(form: URLSearchParams, expected: string): void {
  const received = requiredField(form, "formToken");
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  try {
    if (
      receivedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(receivedBytes, expectedBytes)
    ) {
      throw new Error("INVALID_FORM_TOKEN");
    }
  } finally {
    receivedBytes.fill(0);
    expectedBytes.fill(0);
  }
}

function assertOnlyFields(form: URLSearchParams, allowed: string[]): void {
  const allowedFields = new Set(allowed);
  for (const key of form.keys()) {
    if (!allowedFields.has(key) || form.getAll(key).length !== 1) {
      throw new Error("INVALID_ACCOUNT_FORM");
    }
  }
}

function requiredField(form: URLSearchParams, name: string): string {
  const values = form.getAll(name);
  if (values.length !== 1 || !values[0]) throw new Error("INVALID_ACCOUNT_FORM");
  return values[0];
}

function optionalField(form: URLSearchParams, name: string): string {
  const values = form.getAll(name);
  if (values.length !== 1) throw new Error("INVALID_ACCOUNT_FORM");
  return values[0].trim();
}

function decodeAccountId(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!/^[0-9a-f-]{36}$/i.test(decoded)) throw new Error();
    return decoded;
  } catch {
    throw new Error("INVALID_ACCOUNT_REFERENCE");
  }
}

function friendlyAccountError(error: unknown): string {
  const code = error instanceof Error ? error.message : "ACCOUNT_SETUP_FAILED";
  const messages: Record<string, string> = {
    OWNER_CONSENT_REQUIRED: "Confirm the account holder’s view-only access approval.",
    INVALID_OWNER_LABEL: "Enter a valid owner display name.",
    INVALID_ACCOUNT_LABEL: "Enter a valid account nickname.",
    INVALID_BROKER_LABEL: "Enter a valid broker or DP label.",
    INVALID_BOID_LAST4: "Enter exactly the final four digits of the CDSL BO ID.",
    INVALID_CDSL_USERNAME_FORMAT: "Enter the 6–16 character CDSL EASI username using letters, digits, or underscore.",
    INVALID_CDSL_PASSWORD_FORMAT: "Enter the current CDSL EASI password.",
    CDSL_USERNAME_AND_PASSWORD_MUST_DIFFER: "The CDSL username and password cannot be identical.",
    ACCOUNT_REFERENCE_NOT_UNIQUE: "That local account could not be identified safely.",
    INVALID_ACCOUNT_FORM: "Complete each field once and try again.",
    INVALID_FORM_ORIGIN: "Open and submit the form from this local setup page.",
    INVALID_FORM_TOKEN: "Refresh the local setup page and submit the form again.",
    ACCOUNT_FORM_TOO_LARGE: "The submitted form was unexpectedly large.",
    KEYCHAIN_OPERATION_FAILED: "macOS Keychain could not store the credentials. No account was added.",
    KEYCHAIN_HELPER_BUILD_FAILED: "The local macOS Keychain helper could not be prepared.",
  };
  return messages[code] ?? "Account setup stopped safely. Review the fields and try again.";
}

function isLoopbackRequest(request: IncomingMessage, origin: string): boolean {
  const expectedHost = new URL(origin).host;
  const remote = request.socket.remoteAddress;
  return (
    request.headers.host === expectedHost &&
    (remote === "127.0.0.1" || remote === "::ffff:127.0.0.1")
  );
}

function safeDashboardUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "cache-control": "no-store, max-age=0",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "content-type": "text/html; charset=utf-8",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    pragma: "no-cache",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(body);
}

function sendPlain(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function listenOnLoopback(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}
