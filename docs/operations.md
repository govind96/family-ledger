# MVP operations runbook

## Start of day

1. Log into the dedicated encrypted Mac account.
2. Start the dashboard with `npm run dev:secure`.
3. Run one selected account with `npm run sync:cdsl -- --account <prefix>` during the pilot.
4. If the Gmail collector is connected, verify that no OTP prompt appears. Otherwise enter the current OTP only when asked in the terminal.
5. Confirm the worker reports a reconciled row count and short synchronization reference.
6. Open the dashboard and verify the account's holdings date, price date, and health state.

After initial setup or signing-key rotation, run `npm run test:ingestion` once.
It sends a signed validation probe to the loopback dashboard and expects the
authenticated request to reach payload validation. It does not contact CDSL or
write a dashboard snapshot.

Add or repair accounts through the dashboard's **Add account** button while
`npm run dev:secure` is running. The button opens a separate loopback-only
setup service. Close that tab when finished; never enter CDSL credentials into
the dashboard URL, chat, logs, or screenshots.

## Gmail OTP collector

Use a dedicated Gmail inbox that receives only filtered CDSL OTP forwards. In
every source mailbox, register and verify that forwarding address, then make a
filter that forwards only CDSL OTP mail. Never forward all family email.

Create a Google **Desktop app** OAuth client in a project with the Gmail API
enabled, configure the Google Auth Platform for an external audience, and set
its publishing status to **Production**. A project left in Testing invalidates
refresh tokens after seven days. Connect it once:

```bash
npm run gmail:connect -- --credentials "/absolute/path/to/client_secret.json"
```

The connector stores a revocable refresh token in macOS Keychain. It requests
`gmail.readonly`; because that scope permits reading the authorized mailbox,
the dedicated collector inbox is a required privacy boundary. The application
itself uses a fixed `newer_than:1d CDSL` query and reads only new candidate
messages after each login begins. It does not retain the access token, OTP, or
message body after the process exits. After CDSL asks for an OTP, it waits up
to four minutes for the forwarded message before stopping safely.

Force the hidden terminal prompt for one run with `--manual-otp`. Remove both
the Google grant and local Keychain entry with `npm run gmail:disconnect`.

## Safe-stop conditions

Do not work around these conditions:

- CAPTCHA appears.
- Mobile plus email OTP is unexpectedly requested.
- CDSL reports invalid, locked, or expired credentials.
- Easiest transaction controls are detected.
- The holdings table or a required column cannot be found.
- Duplicate ISINs, malformed decimals, or total mismatch occurs.
- Session timeout or unrecognized navigation occurs.
- Ingestion signature, replay, or persistence validation fails.

The previous successful dashboard snapshot remains authoritative after any safe stop.

An existing CDSL EASI session is ended automatically so the unattended sync
can continue; tell family members that an open CDSL browser may be signed out.
Only one replacement is attempted. `INVALID_CREDENTIALS`, `PASSWORD_EXPIRED`,
`ACCOUNT_LOCKED`, `CAPTCHA_REQUIRED`, `GMAIL_OTP_TIMED_OUT`,
`GMAIL_OAUTH_REAUTH_REQUIRED`, and `MULTIPLE_OTP_FIELDS_REQUIRED` are distinct
safe stops; do not repeatedly retry them.

For `LOGIN_FLOW_TIMED_OUT`, perform one diagnostic run:

```bash
npm run sync:cdsl -- --account <account-reference-prefix> --verbose
```

Verbose output is deliberately metadata-only. Review it for the last
`network.response`, `network.blocked`, `page.navigated`, and `auth.state`
events. It excludes credentials, OTPs, cookies, bodies, page content, URL
queries, and holding values.

During initial onboarding, add `--show-browser` to the verbose command. The
disposable browser runs visibly and pauses after a safe stop until Enter is
pressed in the terminal. Use a private screen; the page itself may show account
or holdings information even though the terminal log does not.

## Reconciliation check

For the first five days of each new account:

- Compare the number of ISIN rows with CDSL Account Details.
- Compare every ISIN and settled quantity exactly.
- Compare the summed holding value within the documented rounding tolerance.
- Confirm that no transaction Setup, Upload, Trusted Account, or transfer control is present.
- Record only the result and synchronization reference—never authenticated screenshots or credentials.

## Incident response

### Suspected credential exposure

1. Stop the worker.
2. Change the CDSL password through the official site.
3. Update the stored credentials through the local account setup form. Remove the account only if its local identity and future synchronization should also be revoked.
4. Revoke any mailbox authorization.
5. Rotate the ingestion key.
6. Review dashboard audit events and OS login history.
7. Re-onboard only after the cause is understood.

### Parser/page change

1. Keep the previous snapshot; do not manually force the new result into storage.
2. Reproduce with a sanitized or synthetic fixture.
3. Update aliases/selectors and parser version.
4. Run parser, reconciliation, security, and rendered-page tests.
5. Validate one account manually before re-enabling the schedule.

### Owner revocation

1. Remove the local account and its Keychain entries.
2. Disable its future scheduler job.
3. Apply the owner's historical-data retention choice.
4. Record a sanitized revocation audit event.

## Current scheduling boundary

The sync command is now non-interactive when the Gmail collector is connected:
running `npm run sync:cdsl` processes every enabled account sequentially. A
daily macOS scheduler is intentionally not installed by the repository yet.
Enable one only after three accounts complete safely on three consecutive
business days, and only while the loopback secure dashboard is running. A
scheduled failure preserves every last-known-good snapshot.

## Hosted dashboard boundary

The hosted dashboard is deployed owner-only first. It contains normalized
holdings only; CDSL credentials, Gmail authorization, OTPs, browser sessions,
full BO IDs, and raw CDSL downloads remain on the encrypted Mac.

Cloudflare Access also protects the ingestion URL. The local worker therefore
uses a revocable service token to cross that outer gate, then
the request must independently pass the existing HMAC signature, five-minute
timestamp, one-use nonce, strict schema, and exact reconciliation checks. Store
the production endpoint and token in Keychain with `npm run hosted:connect --
--endpoint https://<host>/api/sync/ingest`. Remove the local connection with
`npm run hosted:disconnect`; rotate the token at the hosting layer if exposure
is suspected.
