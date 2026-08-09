# Security policy

## Security objective

Family Ledger minimizes both transaction risk and credential exposure while creating a read-oriented family holdings view. No software can guarantee the absence of every security issue; this project therefore uses layered controls, fails closed, and keeps the first deployment private and local.

## Trust boundaries

### Local operator machine

The CDSL worker runs only on a dedicated, encrypted macOS account. CDSL usernames, passwords, and the ingestion signing key are stored in macOS Keychain. They are decrypted into memory only for a short-lived process.

### Disposable browser

Every account uses a fresh, non-persistent headless browser context. The CDSL
holdings CSV is accepted only into Playwright-managed temporary storage,
bounded to ten megabytes, streamed into memory, and removed with the browser
context. Persistent downloads, service workers, screenshots, video, traces,
and saved browser profiles are disabled. The browser accepts only CDSL hosts,
and non-GET requests are restricted to login, OTP verification, holdings, and
refresh paths.

### Dashboard and database

The dashboard receives normalized holdings through a signed ingestion endpoint. It never receives CDSL credentials, OTPs, PANs, full BO IDs, or session cookies. Snapshot commits are atomic; validation failures leave the previous successful snapshot untouched.

## Implemented controls

- EASI-only operational requirement and transaction-control detection.
- Explicit owner consent in local account metadata.
- Credentials and signing key in macOS Keychain.
- Hidden credential and OTP entry.
- No secret values in process arguments, source files, configuration, logs, screenshots, exports, or database columns. A small local native helper sends secret bytes to Apple's Security framework through process input, avoiding the interactive `security -w` prompt and command-line exposure.
- HMAC-SHA-256 request authentication.
- Five-minute signature lifetime and one-use nonce replay protection.
- One-megabyte streaming request limit.
- Strict payload schemas that reject unknown and credential-shaped fields.
- Exact decimal parsing and total reconciliation.
- Atomic snapshot persistence and last-known-good behavior.
- Deny-by-default administrator email allowlist outside localhost.
- Owner-only hosted access at initial deployment. Machine ingestion traverses
  the hosted sign-in boundary with a revocable Cloudflare Access service token stored in Keychain,
  then still must pass the independent HMAC, timestamp, nonce, schema, and
  reconciliation checks.
- No-store caching, clickjacking protection, restrictive browser permissions, referrer suppression, and content restrictions.
- CSV-formula injection mitigation on exports.
- No CAPTCHA bypass or repeated authentication retries.
- Automatic termination of one existing CDSL EASI web session per sync attempt, with no repeated replacement loop.
- Gmail OAuth with PKCE, loopback callback, state validation, read-only scope, Keychain refresh-token storage, and explicit revocation.
- Per-login Gmail message baselines, bounded polling, conservative labelled-code extraction, and no OTP or email-body persistence.

## Residual risks

- A process running as the same unlocked macOS user may be able to invoke Keychain access under that user's policy. Use a dedicated OS account, FileVault, screen lock, and minimal installed software.
- A fully compromised worker can read credentials while a synchronization is running. Source-level EASI downgrade and short-lived worker/browser processes limit impact.
- CDSL's UI or authentication may change. Parser signatures, exact reconciliation, prohibited-action checks, and last-known-good persistence prevent silent replacement with malformed data.
- Absence of visible Easiest controls is not cryptographic proof of account type. The account holder must complete and verify the CDSL downgrade independently.
- OTP interception grants a short authentication window. OTPs are never persisted. The Gmail API's read-only scope can technically read the entire authorized mailbox even though this connector uses a narrow CDSL query, so only a dedicated OTP collector inbox may be authorized.
- Automatically ending an older CDSL session can sign an account holder out of an open EASI browser. The worker performs at most one replacement per account attempt.
- CDSL terms may restrict automated access or credential delegation. Use only with owner consent in a private pilot and obtain written clarification before broader deployment.

## Dependency posture

The production-dependency audit is the release gate and currently reports no
known vulnerabilities. The full development-tool audit still reports the
upstream `image-size` denial-of-service advisories through `vinext`; no patched
compatible release is available. Family Ledger does not register vinext's
image-optimization route, does not process untrusted images during builds, and
the affected parser is absent from the generated runtime bundle. Recheck this
advisory on every dependency update and upgrade as soon as a compatible fix is
published; do not use `npm audit fix --force` to apply the suggested breaking
downgrade without a fresh security and compatibility review.

## Secret rotation

- Change a CDSL password at CDSL, then use the loopback-only **Update login** form or `npm run account:credentials -- --account <prefix>` to replace that account's Keychain values without changing its local identity.
- Run `npm run security:init` to rotate the ingestion key. Restart the secure dashboard and all local workers immediately.
- Rotate the hosted Cloudflare Access service token and reconnect it
  locally whenever access may have been exposed. Removing the Keychain entry
  with `npm run hosted:disconnect` stops this Mac from reaching the hosted
  ingestion route.
- If exposure is suspected, stop the worker, disable the account locally, change the CDSL password, revoke mailbox access, rotate the ingestion key, and review audit events.

## Reporting a vulnerability

Do not include real credentials, OTPs, PANs, BO IDs, session cookies, holdings, or authenticated page captures in a report. Reproduce with synthetic values and identify the affected file and behavior.
