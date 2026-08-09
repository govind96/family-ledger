# Family Ledger

Family Ledger is a private, local-first dashboard for consolidating settled CDSL demat holdings across authorized family accounts.

The current MVP implements:

- A private consolidated holdings and account-health dashboard.
- Synthetic preview data until a real snapshot is deliberately ingested.
- A headless CDSL EASI connector with automatic Gmail OTP retrieval and manual fallback.
- macOS Keychain storage for CDSL credentials, Gmail authorization, and the ingestion signing key.
- Strict HMAC-authenticated ingestion with timestamp and replay protection.
- Exact decimal parsing and reconciliation.
- Atomic last-known-good snapshots in D1.
- CSV and print/PDF exports from normalized data.
- Inline owner-level holding detail, sorting, and closing-price charts built
  only from prior reconciled CDSL snapshots.
- An optional, local-only experimental NSE price overlay for the secure
  dashboard. It never changes the reconciled CDSL snapshot.
- Deny-by-default hosted authorization and defensive response headers.

It does not place trades, transfer securities, bypass CAPTCHA, solve OTP challenges, or store PANs, full BO IDs, passwords, OTPs, or browser sessions in the dashboard database.

## Safety prerequisites

Before connecting an account:

1. Obtain explicit authorization from the account holder.
2. Confirm the CDSL login is **EASI**, not Easiest. If transaction controls are visible, use CDSL's “Reassign login to easi account” flow and wait for DP approval.
3. Use a dedicated, FileVault-encrypted Mac user account for the worker.
4. Do not reuse the CDSL password for any other service.
5. Keep the dashboard local/private during the pilot.

Read [SECURITY.md](SECURITY.md) and [docs/operations.md](docs/operations.md) before using real credentials.

## Local preview

The ordinary development command shows only synthetic data and leaves ingestion disabled:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Initialize the secure local path

Generate a random ingestion signing key directly into macOS Keychain:

```bash
npm run security:init
```

Start the dashboard with that key injected into process memory, never written to a project file:

```bash
npm run dev:secure
```

The launcher rejects missing, truncated, or legacy weak keys. Run
`npm run security:init` to replace an invalid key, then restart the secure
dashboard. You can verify the signed local handoff without contacting CDSL,
using an OTP, or writing a dashboard snapshot:

```bash
npm run test:ingestion
```

This secure command switches the loopback-only preview from synthetic data to
the last successfully ingested local snapshots. The ordinary `npm run dev`
command always stays in synthetic preview mode.

Add one authorized EASI account. Credential input is hidden and stored in Keychain; only a nickname and the final four BO-ID digits are written to the ignored local configuration file:

```bash
npm run account:add
```

This terminal flow asks for the CDSL username and password once each. It does
not ask for separate “password data” or “retype password” values.

For a local form instead, start the loopback-only account setup service:

```bash
npm run account:ui
```

Open the private URL printed in the terminal. When the dashboard is started
with `npm run dev:secure`, the same form is available through its **Add
account** button. The form runs in a separate local process: credentials never
enter the dashboard worker, database, logs, command arguments, or project
files.

To repair or rotate credentials while preserving an existing account reference
and holdings history, use **Update login** in that form or run:

```bash
npm run account:credentials -- --account <account-reference-prefix>
```

Run the first controlled synchronization:

```bash
npm run sync:cdsl -- --account <account-reference-prefix>
```

Without Gmail setup, the worker asks for the current OTP in the terminal. If
CDSL presents CAPTCHA, additional authentication, expired credentials,
transaction capabilities, or an unexpected page, it stops without changing
the dashboard snapshot.

## Connect a dedicated Gmail OTP inbox

Use a new Gmail account that contains only forwarded CDSL OTP messages. Do not
authorize a family member's normal mailbox: Gmail's narrowest read-only API
scope still technically permits the connector to read that entire mailbox.

1. Create the dedicated Gmail collector account and enable two-step verification on it.
2. In each account holder's Gmail, add the collector as a forwarding address, complete Google's verification, and create a filter that forwards only CDSL OTP messages. Do not forward all mail.
3. In a personal Google Cloud project, enable the Gmail API.
4. Configure the Google Auth Platform for an external audience. Move it to **Production** before relying on unattended refresh tokens; projects left in **Testing** issue refresh tokens that expire after seven days. A personal app with fewer than 100 users may remain unverified, but Google will show its unverified-app warning.
5. Create an OAuth client of type **Desktop app**, download its JSON file, and keep that file outside this repository.
6. Connect the collector:

```bash
npm run gmail:connect -- --credentials "/absolute/path/to/client_secret.json"
```

Google opens once for consent. The app requests only `gmail.readonly`; its
refresh token is stored in macOS Keychain and neither the token nor an email
password is written to this project. You may delete the downloaded OAuth JSON
after a successful connection if the Google Cloud project remains available.

From then on, the ordinary command retrieves a newly arrived, clearly labelled
CDSL OTP automatically:

```bash
npm run sync:cdsl
```

Accounts run sequentially so a new OTP can be tied to the login that just
requested it. The reader records the matching messages before each login,
polls only for a newer message matching `CDSL`, and never stores, logs, labels,
deletes, or marks mail as read. Use `--manual-otp` at any time to bypass Gmail
for that run. Revoke access locally and at Google with:

```bash
npm run gmail:disconnect
```

After authentication, the worker waits for CDSL's account-details request and
for the holdings table to finish rendering and remain stable before it parses
anything. A slow CDSL response therefore delays the sync instead of producing
a partial or empty snapshot. It parses CDSL's holdings CSV from the browser's
temporary download storage so pagination cannot omit rows, then deletes that
temporary data with the disposable browser context. A validated DOM parser is
kept as a fallback. The worker does not retain CDSL's raw statement downloads,
which may contain additional account identifiers; use the dashboard's
normalized **Download CSV** or **Print / PDF** actions after a successful sync.

Stock charts use the last-closing-price values already present in successful
CDSL snapshots. They do not call an external market-data service, so a new
holding shows its latest close first and gains a chart after at least two daily
snapshot dates are available.

## Experimental NSE price overlay

`npm run dev:secure` also starts a short-lived, loopback-only price helper for
the dashboard. It uses the `stock-nse-india` library directly as a narrow local
client; this project does **not** run that library's REST, GraphQL, MCP, or CLI
server. The helper receives only the ISIN and public security name already on
screen, resolves a matching NSE symbol, verifies the returned ISIN, and returns
only a price or an unavailable state. It binds to `127.0.0.1`, requires a fresh
random URL capability, accepts browser requests only from this dashboard, and
is not available in the hosted app.

The dashboard checks no more than once a minute while NSE reports its capital
market as open or pre-open. When the market is closed, it makes no periodic
requests: after the initial status check it sleeps until the next weekday's
pre-open window. If that day is a holiday, its single check sees the market
closed and sleeps again. A verified result is labelled **Live price**,
**Indicative price**, or **Last NSE price** to match that state, and produces
only an *indicative* portfolio value. Quantities, ownership, CDSL dates,
history, and the stored snapshot remain unchanged. If NSE blocks, delays,
cannot map, or cannot verify a quote, the dashboard keeps showing the last
reconciled CDSL close instead. Restart `npm run dev:secure` after updating to
enable the helper; ordinary `npm run dev` intentionally does not start it.

This is a personal convenience view, not an exchange-authorized real-time data
service. Do not redistribute the output, make trading decisions solely from
it, or rely on it for valuation records.

If CDSL reports that the account is already signed in elsewhere, the worker
automatically ends that older EASI web session and continues. This makes the
sync non-interactive, but it can sign the holder out of an open CDSL browser.
Only one replacement attempt is allowed. Multiple simultaneous OTP fields are
rejected rather than guessed or bypassed.

For a failed login flow, rerun once with sanitized terminal diagnostics:

```bash
npm run sync:cdsl -- --account <account-reference-prefix> --verbose
```

Verbose mode includes timestamps, navigation paths, HTTP status codes, blocked
request reasons, and authentication state changes. It omits usernames,
passwords, OTPs, cookies, request/response bodies, page text, URL queries, and
holding values. Share only this sanitized output when troubleshooting.

For the first controlled login, you can display the worker's disposable
browser and combine it with verbose diagnostics:

```bash
npm run sync:cdsl -- --account <account-reference-prefix> --verbose --show-browser
```

The visible browser uses no saved profile and keeps the same request
restrictions. On failure it pauses until you inspect the page and press Enter
in the terminal. It may display private financial information, so use it only
on a private screen. Continue entering credentials and OTPs only through the
hidden terminal prompts; do not type them into chat or diagnostic output.

## Remove a local account

```bash
npm run account:remove
```

This deletes the selected account's local configuration and Keychain credentials after confirmation. It intentionally does not silently erase historical dashboard snapshots.

## Verification

```bash
npm test
npm run lint
npm run build
npm audit --omit=dev
```

Production dependencies must have no known high or critical vulnerability before real data is used. Development-tool advisories should be reviewed separately because they do not ship in the runtime bundle.

## Current MVP boundary

Automatic OTP retrieval is available through a revocable, read-only Google
OAuth authorization to a dedicated filtered mailbox; no email password is
stored. CAPTCHA is never automated or bypassed. Before installing an unattended
daily schedule, validate at least three accounts manually on three consecutive
business days and confirm the forwarded-email filter matches only CDSL OTPs.

CDSL has no public retail holdings API for this workflow. The connector therefore depends on the published EASI website and can stop when CDSL changes authentication or page structure. Obtain written CDSL/DP clarification before broader or commercial deployment.
