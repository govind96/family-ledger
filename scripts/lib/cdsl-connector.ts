import Decimal from "decimal.js";
import { chromium, type Locator, type Page, type Route } from "playwright";
import type { LocalAccount } from "./account-config";
import {
  extractCdslCsvAsOfDate,
  MAX_CDSL_CSV_BYTES,
  parseCdslHoldingsCsv,
} from "./cdsl-csv";
import {
  classifyCdslLoginState,
  type CdslLoginObservation,
  type CdslLoginState,
} from "./cdsl-login-state";
import type { CdslCredentials } from "./keychain";
import { normalizeHoldingTable, type TableMatrix } from "./holdings-parser";

const LOGIN_URL = "https://web.cdslindia.com/myeasitoken/Home/Login";
const ACCOUNT_DETAILS_URL =
  "https://web.cdslindia.com/myeasitoken/bo/accountdetails";
const ACCOUNT_DETAILS_DATA_PATH =
  "/myeasitoken/BO/GetAccountDetails";
const HOLDINGS_LOAD_TIMEOUT_MS = 30_000;
const HOLDINGS_STABILITY_INTERVAL_MS = 250;
const HOLDINGS_STABLE_SAMPLES = 3;
const ALLOWED_HOSTS = new Set([
  "web.cdslindia.com",
  "www.cdslindia.com",
  "cdslindia.com",
]);
const PARSER_VERSION = "cdsl-csv-primary-v2";
const OTP_INPUT_SELECTOR = [
  'input:visible[name*="otp" i]',
  'input:visible[id*="otp" i]',
  'input:visible[placeholder*="otp" i]',
  'input:visible[autocomplete="one-time-code"]',
  '#modalChkOTP:visible input:visible:not([type="hidden"]):not([type="button"]):not([type="submit"])',
  'form:visible[action*="VerifyOTP" i] input:visible:not([type="hidden"]):not([type="button"]):not([type="submit"])',
  '.modal:visible:has-text("One Time Password") input:visible:not([type="hidden"]):not([type="button"]):not([type="submit"])',
  '.modal:visible:has-text("Enter OTP") input:visible:not([type="hidden"]):not([type="button"]):not([type="submit"])',
].join(", ");
const OTP_CHALLENGE_SELECTOR = [
  "#modalChkOTP:visible",
  'form:visible[action*="VerifyOTP" i]',
  '.modal:visible:has-text("One Time Password")',
  '.modal:visible:has-text("Enter OTP")',
].join(", ");

export type ExtractedSnapshot = {
  account: LocalAccount;
  startedAt: string;
  completedAt: string;
  sourceAsOfDate: string;
  priceDate: string;
  sourceTotalValue: string;
  parserVersion: string;
  pageSignature: string;
  holdings: ReturnType<typeof normalizeHoldingTable>["holdings"];
};

export type CdslDiagnosticEvent = Readonly<{
  event: string;
  target?: string;
  method?: string;
  status?: number;
  resourceType?: string;
  state?: CdslLoginState;
  otpFields?: number;
  otpChallenge?: boolean;
  hasError?: boolean;
  reason?: string;
  rows?: number;
}>;

export type CdslDiagnosticLogger = (event: CdslDiagnosticEvent) => void;

export async function extractCdslHoldings(input: {
  account: LocalAccount;
  credentials: CdslCredentials;
  getOtp: () => Promise<string>;
  replaceActiveSession: boolean;
  log?: CdslDiagnosticLogger;
  showBrowser?: boolean;
  pauseOnFailure?: () => Promise<void>;
}): Promise<ExtractedSnapshot> {
  const startedAt = new Date().toISOString();
  input.log?.({ event: "connector.start" });
  const browser = await chromium.launch({
    headless: !input.showBrowser,
    slowMo: input.showBrowser ? 150 : 0,
  });
  input.log?.({ event: "browser.started" });

  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      serviceWorkers: "block",
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      viewport: { width: 1365, height: 900 },
    });
    const page = await context.newPage();
    attachNetworkDiagnostics(page, input.log);
    await page.route("**/*", (route) =>
      enforceNetworkPolicy(route, input.log),
    );

    input.log?.({ event: "login.navigate", target: safeTarget(LOGIN_URL) });
    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    input.log?.({
      event: "login.ready",
      target: safeTarget(page.url()),
    });
    await rejectCaptcha(page);
    await page.locator("#UserName").fill(input.credentials.username);
    await page.locator("#tPassword").fill(input.credentials.password);
    input.log?.({ event: "login.credentials_filled" });
    input.log?.({ event: "login.submit" });
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {}),
      page.locator("#btn-login").click(),
    ]);

    await rejectCaptcha(page);
    await completeAuthentication(page, {
      getOtp: input.getOtp,
      replaceActiveSession: input.replaceActiveSession,
      log: input.log,
    });

    input.log?.({
      event: "account_details.navigate",
      target: safeTarget(ACCOUNT_DETAILS_URL),
    });
    await page.goto(ACCOUNT_DETAILS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await rejectSessionTimeout(page);
    await verifyViewRights(page);
    input.log?.({ event: "view_rights.verified" });

    await waitForHoldingTableReady(page, { log: input.log });

    const refreshControl = page
      .getByRole("link", { name: /refresh data/i })
      .or(page.getByRole("button", { name: /refresh data/i }))
      .first();
    if (await refreshControl.isVisible().catch(() => false)) {
      input.log?.({ event: "holdings.refresh_requested" });
      const [response] = await Promise.all([
        page.waitForResponse(
          (candidate) =>
            candidate.request().method() === "POST" &&
            isAccountDetailsDataResponse(candidate.url()),
          { timeout: HOLDINGS_LOAD_TIMEOUT_MS },
        ),
        refreshControl.click(),
      ]);
      if (!response.ok()) throw new Error("HOLDINGS_REFRESH_FAILED");
      input.log?.({
        event: "holdings.refresh_complete",
        status: response.status(),
      });
      await page.waitForTimeout(HOLDINGS_STABILITY_INTERVAL_MS);
      await waitForHoldingTableReady(page, { log: input.log });
    }

    let matrix: TableMatrix;
    let expectedDomRows: number | null = null;
    try {
      matrix = await downloadHoldingCsvMatrix(page, input.log);
      input.log?.({ event: "holdings.source_csv" });
    } catch (error) {
      input.log?.({
        event: "holdings.csv_fallback",
        reason: safeCsvFallbackReason(error),
      });
      await showMaximumHoldingRows(page);
      await waitForHoldingTableReady(page, { log: input.log });
      expectedDomRows = await readReportedHoldingCount(page);
      matrix = await extractHoldingMatrix(page);
      input.log?.({ event: "holdings.source_dom" });
    }
    const normalized = normalizeHoldingTable(matrix);
    const csvAsOfDate = extractCdslCsvAsOfDate(matrix);
    if (
      expectedDomRows !== null &&
      normalized.holdings.length !== expectedDomRows
    ) {
      throw new Error("HOLDINGS_TABLE_PAGINATED");
    }
    input.log?.({
      event: "holdings.parsed",
      rows: normalized.holdings.length,
    });
    const bodyText = await page.locator("body").innerText();
    const displayedPortfolioTotal = extractPortfolioTotal(bodyText);
    if (
      displayedPortfolioTotal !== null &&
      !new Decimal(displayedPortfolioTotal).eq(normalized.sourceTotalValue)
    ) {
      throw new Error("HOLDINGS_TOTAL_RECONCILIATION_FAILED");
    }
    const priceDate = extractDate(bodyText, [
      /closing (?:price|rate).*?(\d{1,2}[-/]\w{3}[-/]\d{4})/i,
      /price\s+as\s+on.*?(\d{1,2}[-/]\w{3}[-/]\d{4})/i,
    ]);

    await context.close();
    return {
      account: input.account,
      startedAt,
      completedAt: new Date().toISOString(),
      sourceAsOfDate: csvAsOfDate ?? indiaDate(new Date()),
      priceDate:
        priceDate ?? csvAsOfDate ?? previousWeekdayIndiaDate(new Date()),
      sourceTotalValue:
        displayedPortfolioTotal ?? normalized.sourceTotalValue,
      parserVersion: PARSER_VERSION,
      pageSignature: normalized.pageSignature,
      holdings: normalized.holdings,
    };
  } catch (error) {
    if (input.showBrowser && input.pauseOnFailure) {
      input.log?.({ event: "browser.paused_after_failure" });
      await input.pauseOnFailure().catch(() => {});
    }
    throw error;
  } finally {
    input.credentials.username = "";
    input.credentials.password = "";
    await browser.close().catch(() => {});
    input.log?.({ event: "browser.closed" });
  }
}

async function completeAuthentication(
  page: Page,
  input: {
    getOtp: () => Promise<string>;
    replaceActiveSession: boolean;
    log?: CdslDiagnosticLogger;
  },
): Promise<void> {
  let deadline = Date.now() + 30_000;
  let sessionReplacementAttempted = false;
  let otpSubmittedAt: number | null = null;
  let lastStateFingerprint = "";

  while (Date.now() < deadline) {
    const observation = await observeLoginState(page);
    const state = classifyCdslLoginState(observation);
    const target = safeTarget(observation.url);
    const stateFingerprint = [
      state,
      target,
      observation.visibleOtpFields,
      observation.otpChallengeVisible ? "challenge" : "no-challenge",
      observation.errorText ? "error" : "clear",
    ].join("|");
    if (stateFingerprint !== lastStateFingerprint) {
      input.log?.({
        event: "auth.state",
        state,
        target,
        otpFields: observation.visibleOtpFields,
        otpChallenge: observation.otpChallengeVisible,
        hasError: Boolean(observation.errorText.trim()),
      });
      lastStateFingerprint = stateFingerprint;
    }

    if (state === "authenticated") {
      input.log?.({ event: "auth.complete", target });
      return;
    }
    if (state === "session_timeout") throw new Error("SESSION_TIMEOUT");
    if (state === "captcha") throw new Error("CAPTCHA_REQUIRED");
    if (state === "password_expired") throw new Error("PASSWORD_EXPIRED");
    if (state === "account_locked") throw new Error("ACCOUNT_LOCKED");
    if (state === "invalid_credentials") {
      throw new Error("INVALID_CREDENTIALS");
    }
    if (state === "multiple_otp") {
      throw new Error("MULTIPLE_OTP_FIELDS_REQUIRED");
    }
    if (state === "rejected") {
      throw new Error(
        otpSubmittedAt === null ? "LOGIN_REJECTED" : "OTP_VERIFICATION_FAILED",
      );
    }

    if (state === "active_session") {
      if (sessionReplacementAttempted) {
        throw new Error("ACTIVE_SESSION_COULD_NOT_BE_REPLACED");
      }
      if (!input.replaceActiveSession) {
        throw new Error("ACTIVE_SESSION_REPLACEMENT_DISABLED");
      }
      input.log?.({ event: "active_session.replacement_approved" });

      const replaceSession = page.locator("#btnDelSession:visible").first();
      if (!(await replaceSession.isVisible().catch(() => false))) {
        throw new Error("ACTIVE_CDSL_SESSION_EXISTS");
      }
      await Promise.all([
        page
          .waitForLoadState("domcontentloaded", { timeout: 30_000 })
          .catch(() => {}),
        replaceSession.click(),
      ]);
      input.log?.({ event: "active_session.replacement_submitted" });
      sessionReplacementAttempted = true;
      deadline = Date.now() + 30_000;
      continue;
    }

    if (state === "otp") {
      if (otpSubmittedAt !== null) {
        if (Date.now() - otpSubmittedAt >= 5_000) {
          throw new Error("OTP_VERIFICATION_FAILED");
        }
        await page.waitForTimeout(250);
        continue;
      }
      input.log?.({ event: "otp.prompt" });
      await submitOtp(page, input.getOtp);
      input.log?.({ event: "otp.submitted" });
      otpSubmittedAt = Date.now();
      deadline = Date.now() + 30_000;
      continue;
    }

    await page.waitForTimeout(250);
  }

  input.log?.({
    event: "auth.timeout",
    target: safeTarget(page.url()),
  });
  throw new Error("LOGIN_FLOW_TIMED_OUT");
}

async function observeLoginState(page: Page): Promise<CdslLoginObservation> {
  const pageTitle = await page.title().catch(() => "");
  const otpFields = page.locator(OTP_INPUT_SELECTOR);
  const visibleErrors = page.locator(
    "#errSummary:visible, .validation-summary-errors:visible, .bootbox-body:visible, .alert:visible",
  );
  const hiddenErrorField = page.locator("#hderrormsg").first();
  const hiddenError = (await hiddenErrorField.count())
    ? await hiddenErrorField
        .evaluate((field) =>
          field instanceof HTMLInputElement
            ? field.value
            : (field.getAttribute("value") ?? ""),
        )
        .catch(() => "")
    : "";
  const errorText = [
    hiddenError,
    ...(await visibleErrors.allTextContents().catch(() => [])),
  ].join(" ");

  return {
    url: page.url(),
    visibleOtpFields: await logicalOtpFieldCount(otpFields),
    otpChallengeVisible: await page
      .locator(OTP_CHALLENGE_SELECTOR)
      .first()
      .isVisible()
      .catch(() => false),
    sessionTimeoutVisible: /session.*(?:expired|timeout|timed out)/i.test(
      pageTitle,
    ),
    captchaVisible: await page
      .locator(
        '.g-recaptcha:visible, iframe:visible[src*="recaptcha"], iframe:visible[title*="recaptcha" i]',
      )
      .first()
      .isVisible()
      .catch(() => false),
    activeSessionVisible: await page
      .locator("#modalAlreadySignin:visible")
      .isVisible()
      .catch(() => false),
    passwordExpiredVisible: await page
      .locator("#modalExpiredPwd:visible")
      .isVisible()
      .catch(() => false),
    errorText,
  };
}

async function submitOtp(
  page: Page,
  getOtp: () => Promise<string>,
): Promise<void> {
  const otpInputs = page.locator(OTP_INPUT_SELECTOR);
  const inputCount = await otpInputs.count();
  if (inputCount === 0) throw new Error("OTP_INPUT_NOT_FOUND");
  let otp = await getOtp();
  try {
    if (!/^\d{4,8}$/.test(otp)) throw new Error("INVALID_OTP_FORMAT");
    if (inputCount === 1) {
      await otpInputs.first().fill(otp);
    } else if (await isSegmentedOtpInput(otpInputs)) {
      if (otp.length !== inputCount) throw new Error("INVALID_OTP_FORMAT");
      for (let index = 0; index < inputCount; index += 1) {
        await otpInputs.nth(index).fill(otp[index]);
      }
    } else {
      throw new Error("MULTIPLE_OTP_FIELDS_REQUIRED");
    }
  } finally {
    otp = "";
  }

  const scopedSubmit = page.locator(
    '#btnVerifyOTP:visible, #modalChkOTP:visible button:visible:not([data-bs-dismiss]), form:visible[action*="VerifyOTP" i] button:visible, form:visible[action*="VerifyOTP" i] input:visible[type="submit"]',
  );
  const submit = (await scopedSubmit.count())
    ? scopedSubmit.first()
    : page
        .getByRole("button", { name: /submit|verify|continue|proceed/i })
        .filter({ visible: true })
        .first();
  if (!(await submit.isVisible().catch(() => false))) {
    throw new Error("OTP_SUBMIT_NOT_FOUND");
  }
  await Promise.all([
    page
      .waitForLoadState("domcontentloaded", { timeout: 30_000 })
      .catch(() => {}),
    submit.click(),
  ]);
}

async function logicalOtpFieldCount(fields: Locator): Promise<number> {
  const count = await fields.count();
  if (count <= 1) return count;
  return (await isSegmentedOtpInput(fields)) ? 1 : count;
}

async function isSegmentedOtpInput(fields: Locator): Promise<boolean> {
  return fields.evaluateAll((inputs) => {
    if (inputs.length < 2) return false;
    const containers = inputs.map((input) =>
      input.closest("form, [role=dialog], .modal") ?? input.parentElement,
    );
    return (
      inputs.every((input) => (input as HTMLInputElement).maxLength === 1) &&
      containers.every((container) => container === containers[0])
    );
  });
}

async function rejectCaptcha(page: Page): Promise<void> {
  const captcha = page.locator(
    '.g-recaptcha:visible, iframe:visible[src*="recaptcha"], iframe:visible[title*="recaptcha" i]',
  );
  if (await captcha.first().isVisible().catch(() => false)) {
    throw new Error("CAPTCHA_REQUIRED");
  }
}

async function rejectSessionTimeout(page: Page): Promise<void> {
  if (/sessiontimeout/i.test(page.url())) throw new Error("SESSION_TIMEOUT");
  const title = await page.title();
  if (/session.*(?:expired|timeout)/i.test(title)) {
    throw new Error("SESSION_TIMEOUT");
  }
}

async function verifyViewRights(page: Page): Promise<void> {
  const prohibited = [
    /edit trusted account/i,
    /modify mode of operation/i,
    /upload transactions?/i,
    /setup transactions?/i,
    /account of choice transfer/i,
  ];
  const navigationText = await page.locator("a").evaluateAll((links) =>
    links.map((link) => {
      const anchor = link as HTMLAnchorElement;
      return `${anchor.textContent ?? ""} ${anchor.getAttribute("href") ?? ""}`;
    }),
  );
  const combined = navigationText.join(" ");
  if (prohibited.some((pattern) => pattern.test(combined))) {
    throw new Error("EASIEST_TRANSACTION_RIGHTS_DETECTED");
  }
  if (!/account\s+details/i.test(combined)) {
    throw new Error("VIEW_RIGHTS_COULD_NOT_BE_VERIFIED");
  }
}

async function extractHoldingMatrix(page: Page): Promise<TableMatrix> {
  return page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll("table"));
    const table = tables.find((candidate) => {
      const headers = Array.from(candidate.querySelectorAll("th"))
        .map((header) => header.textContent?.toLowerCase() ?? "")
        .join(" ");
      return headers.includes("isin") && headers.includes("holding value");
    });
    if (!table) throw new Error("HOLDINGS_TABLE_NOT_FOUND");

    const headers = Array.from(table.querySelectorAll("thead th")).map(
      (header) => header.textContent?.trim() ?? "",
    );
    const fallbackHeaders = headers.length
      ? headers
      : Array.from(table.querySelectorAll("tr:first-child th, tr:first-child td")).map(
          (header) => header.textContent?.trim() ?? "",
        );
    const bodyRows = table.querySelectorAll("tbody tr").length
      ? Array.from(table.querySelectorAll("tbody tr"))
      : Array.from(table.querySelectorAll("tr")).slice(1);
    const rows = bodyRows.map((row) =>
      Array.from(row.querySelectorAll("td")).map(
        (cell) => cell.textContent?.trim() ?? "",
      ),
    );
    return { headers: fallbackHeaders, rows };
  });
}

async function downloadHoldingCsvMatrix(
  page: Page,
  log: CdslDiagnosticLogger | undefined,
): Promise<TableMatrix> {
  const downloadControl = page
    .getByRole("link", { name: /download data as csv file/i })
    .or(page.locator('a[title*="download as csv" i]'))
    .first();
  if (!(await downloadControl.isVisible().catch(() => false))) {
    throw new Error("CDSL_CSV_DOWNLOAD_CONTROL_NOT_FOUND");
  }

  log?.({ event: "holdings.csv_download_requested" });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: HOLDINGS_LOAD_TIMEOUT_MS }),
    downloadControl.click(),
  ]);
  if (await download.failure()) throw new Error("CDSL_CSV_DOWNLOAD_FAILED");
  const stream = await download.createReadStream();
  if (!stream) throw new Error("CDSL_CSV_DOWNLOAD_FAILED");

  const chunks: Buffer[] = [];
  let byteCount = 0;
  let combined: Buffer | null = null;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      byteCount += bytes.length;
      if (byteCount > MAX_CDSL_CSV_BYTES) {
        bytes.fill(0);
        stream.destroy();
        throw new Error("CDSL_CSV_TOO_LARGE");
      }
      chunks.push(bytes);
    }
    const downloadedBytes = Buffer.concat(chunks, byteCount);
    combined = downloadedBytes;
    const matrix = parseCdslHoldingsCsv(downloadedBytes);
    log?.({ event: "holdings.csv_ready", rows: matrix.rows.length });
    return matrix;
  } finally {
    combined?.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

function safeCsvFallbackReason(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return /^CDSL_CSV_[A-Z_]+$/.test(message)
    ? message
    : "CDSL_CSV_DOWNLOAD_UNAVAILABLE";
}

async function showMaximumHoldingRows(page: Page): Promise<void> {
  const pageSize = page
    .locator('select[aria-controls], select[name$="_length"]')
    .first();
  if (!(await pageSize.isVisible().catch(() => false))) return;
  const options = await pageSize.locator("option").evaluateAll((elements) =>
    elements
      .map((element) => (element as HTMLOptionElement).value)
      .filter((value) => /^[1-9]\d*$/.test(value))
      .map(Number),
  );
  if (!options.length) return;
  await pageSize.selectOption(String(Math.max(...options)));
  await page.waitForTimeout(HOLDINGS_STABILITY_INTERVAL_MS);
}

async function readReportedHoldingCount(page: Page): Promise<number | null> {
  const messages = await page.locator(".dataTables_info").allTextContents();
  for (const message of messages) {
    const match = message.match(/\bof\s+([\d,]+)\s+entries\b/i);
    if (!match?.[1]) continue;
    const count = Number(match[1].replaceAll(",", ""));
    if (Number.isSafeInteger(count) && count > 0) return count;
  }
  return null;
}

type HoldingTableReadiness = {
  ready: boolean;
  rows: number;
  fingerprint: string;
};

export async function waitForHoldingTableReady(
  page: Page,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    stableSamples?: number;
    log?: CdslDiagnosticLogger;
  } = {},
): Promise<number> {
  const timeoutMs = options.timeoutMs ?? HOLDINGS_LOAD_TIMEOUT_MS;
  const pollIntervalMs =
    options.pollIntervalMs ?? HOLDINGS_STABILITY_INTERVAL_MS;
  const stableSamples = options.stableSamples ?? HOLDINGS_STABLE_SAMPLES;
  const deadline = Date.now() + timeoutMs;
  let previousFingerprint = "";
  let consecutiveStableSamples = 0;

  options.log?.({ event: "holdings.table_wait" });

  while (Date.now() < deadline) {
    await rejectSessionTimeout(page);
    const state = await observeHoldingTableReadiness(page);

    if (!state.ready) {
      previousFingerprint = "";
      consecutiveStableSamples = 0;
    } else if (state.fingerprint === previousFingerprint) {
      consecutiveStableSamples += 1;
      if (consecutiveStableSamples >= stableSamples) {
        options.log?.({
          event: "holdings.table_ready",
          rows: state.rows,
        });
        return state.rows;
      }
    } else {
      previousFingerprint = state.fingerprint;
      consecutiveStableSamples = 1;
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  throw new Error("HOLDINGS_DATA_LOAD_TIMED_OUT");
}

async function observeHoldingTableReadiness(
  page: Page,
): Promise<HoldingTableReadiness> {
  return page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll("table"));
    const table = tables.find((candidate) => {
      const headers = Array.from(candidate.querySelectorAll("th"))
        .map((header) => header.textContent?.toLowerCase() ?? "")
        .join(" ");
      return headers.includes("isin") && headers.includes("holding value");
    });
    if (!table) return { ready: false, rows: 0, fingerprint: "" };

    const headerCells = Array.from(
      table.querySelectorAll("thead th, tr:first-child th"),
    );
    const headers = headerCells.map((header) =>
      (header.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase(),
    );
    const requiredAliasGroups = [
      ["isin"],
      [
        "isin name",
        "name of company",
        "company name",
        "security name",
        "security description",
        "description",
      ],
      ["isin listing", "listing status", "listed status", "status"],
      [
        "balance (numbers)",
        "balance numbers",
        "balance quantity",
        "quantity",
        "current balance",
        "balance qty",
      ],
      ["last closing price", "closing price", "last close"],
      ["holding value", "market value"],
    ];
    const requiredIndices: number[] = [];
    for (const aliases of requiredAliasGroups) {
      let index = headers.findIndex((header) => aliases.includes(header));
      if (index < 0) {
        index = headers.findIndex((header) =>
          aliases.some((alias) => header.includes(alias)),
        );
      }
      requiredIndices.push(index);
    }
    if (requiredIndices.some((index) => index < 0)) {
      return { ready: false, rows: 0, fingerprint: "" };
    }
    const isinIndex = requiredIndices[0];

    const bodyRows = table.querySelectorAll("tbody tr").length
      ? Array.from(table.querySelectorAll("tbody tr"))
      : Array.from(table.querySelectorAll("tr")).slice(1);
    const validRows = bodyRows.filter((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      const isin = (cells[isinIndex]?.textContent ?? "")
        .replace(/\s+/g, "")
        .toUpperCase();
      return (
        /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin) &&
        requiredIndices.every(
          (index) => (cells[index]?.textContent ?? "").trim().length > 0,
        )
      );
    });
    if (!validRows.length) {
      return { ready: false, rows: 0, fingerprint: "" };
    }

    const normalizedText = `${headers.join("|")}\n${validRows
      .map((row) =>
        Array.from(row.querySelectorAll("td"))
          .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim())
          .join("|"),
      )
      .join("\n")}`;
    let hash = 2166136261;
    for (let index = 0; index < normalizedText.length; index += 1) {
      hash ^= normalizedText.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return {
      ready: true,
      rows: validRows.length,
      fingerprint: `${validRows.length}:${(hash >>> 0).toString(16)}`,
    };
  });
}

function isAccountDetailsDataResponse(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ALLOWED_HOSTS.has(url.hostname) &&
      url.pathname.toLowerCase() === ACCOUNT_DETAILS_DATA_PATH.toLowerCase()
    );
  } catch {
    return false;
  }
}

function attachNetworkDiagnostics(
  page: Page,
  log: CdslDiagnosticLogger | undefined,
): void {
  if (!log) return;

  page.on("request", (request) => {
    if (!shouldLogRequest(request.method(), request.resourceType())) return;
    log({
      event: "network.request",
      method: request.method(),
      target: safeTarget(request.url()),
      resourceType: request.resourceType(),
    });
  });
  page.on("response", (response) => {
    const request = response.request();
    if (!shouldLogRequest(request.method(), request.resourceType())) return;
    log({
      event: "network.response",
      method: request.method(),
      target: safeTarget(response.url()),
      resourceType: request.resourceType(),
      status: response.status(),
    });
  });
  page.on("requestfailed", (request) => {
    if (!shouldLogRequest(request.method(), request.resourceType())) return;
    log({
      event: "network.failed",
      method: request.method(),
      target: safeTarget(request.url()),
      resourceType: request.resourceType(),
      reason: "request_failed",
    });
  });
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    log({ event: "page.navigated", target: safeTarget(frame.url()) });
  });
}

async function enforceNetworkPolicy(
  route: Route,
  log: CdslDiagnosticLogger | undefined,
): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  if (url.protocol !== "https:") {
    log?.({
      event: "network.blocked",
      method: request.method(),
      target: safeTarget(request.url()),
      resourceType: request.resourceType(),
      reason: "non_https",
    });
    await route.abort("blockedbyclient");
    return;
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    log?.({
      event: "network.blocked",
      method: request.method(),
      target: safeTarget(request.url()),
      resourceType: request.resourceType(),
      reason: "host_not_allowed",
    });
    await route.abort("blockedbyclient");
    return;
  }

  if (request.method() !== "GET") {
    const allowedWrite =
      url.pathname === "/myeasitoken/Home/Login" ||
      /otp|verify|validate|auth|accountdetails|holding|refresh/i.test(
        url.pathname,
    );
    if (!allowedWrite) {
      log?.({
        event: "network.blocked",
        method: request.method(),
        target: safeTarget(request.url()),
        resourceType: request.resourceType(),
        reason: "write_path_not_allowed",
      });
      await route.abort("blockedbyclient");
      return;
    }
  }
  await route.continue();
}

function shouldLogRequest(method: string, resourceType: string): boolean {
  return (
    method !== "GET" ||
    resourceType === "document" ||
    resourceType === "xhr" ||
    resourceType === "fetch"
  );
}

export function safeTarget(value: string): string {
  try {
    const url = new URL(value);
    const pathname = url.pathname
      .split("/")
      .map((segment) => (isSensitivePathSegment(segment) ? ":redacted" : segment))
      .join("/");
    return `${url.protocol}//${url.hostname}${pathname}`;
  } catch {
    return "invalid-url";
  }
}

function isSensitivePathSegment(segment: string): boolean {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return true;
  }
  return (
    /^\d{8,}$/.test(decoded) ||
    /^[A-Z]{5}\d{4}[A-Z]$/i.test(decoded) ||
    /^[A-Za-z0-9_.-]{20,}$/.test(decoded)
  );
}

function extractDate(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const parsed = new Date(match[1].replace(/-/g, " "));
    if (!Number.isNaN(parsed.getTime())) return indiaDate(parsed);
  }
  return null;
}

function extractPortfolioTotal(text: string): string | null {
  const match = text.match(
    /total portfolio value\s*=\s*(?:₹\s*)?([\d,]+(?:\.\d+)?)/i,
  );
  if (!match?.[1]) return null;
  const normalized = match[1].replaceAll(",", "");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  return new Decimal(normalized).toFixed(4);
}

function indiaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function previousWeekdayIndiaDate(date: Date): string {
  const candidate = new Date(date);
  candidate.setUTCDate(candidate.getUTCDate() - 1);
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }
  return indiaDate(candidate);
}
