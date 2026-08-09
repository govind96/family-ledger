# Threat model

## Protected assets

- CDSL username and password.
- Short-lived OTP and authenticated browser session.
- Owner identity, masked demat metadata, holdings, and valuations.
- Ingestion signing key.
- Snapshot integrity and freshness.

## Primary adversaries

- An unauthenticated network visitor.
- A malicious website attempting cross-site actions or framing.
- Malware or another process on the worker machine.
- A compromised dashboard dependency or build artifact.
- A person with dashboard access who should not receive vault access.
- Malformed or unexpectedly changed CDSL content.
- Replay or tampering between worker and dashboard.

## Abuse cases and controls

| Abuse case | Control |
|---|---|
| Steal CDSL passwords from the database | Credentials never enter the database; opaque local references only |
| Retrieve credentials through the dashboard | Dashboard process has no Keychain or vault interface |
| Replay a valid holdings payload | Short timestamp window plus unique nonce stored atomically |
| Modify a signed payload | HMAC covers timestamp, nonce, and exact body bytes |
| Replace valid holdings with an empty/partial page | Required columns, non-empty rows, unique ISINs, reconciliation, atomic last-known-good commit |
| Use browser automation to transfer securities | EASI operational requirement, prohibited-control detection, host/method route restrictions, no transfer code |
| Trigger unauthorized browser writes | No browser write UI; machine ingestion requires HMAC; unknown fields rejected |
| Expose data through browser cache or embedding | Private/no-store responses, frame denial, referrer suppression, restrictive permissions |
| Inject a spreadsheet formula through a security name | Export cells beginning with formula characters are prefixed before CSV quoting |
| Capture a secret in logs or diagnostics | Typed sanitized errors; no page screenshots/tracing; no request bodies or response pages logged |
| Brute-force OTP/password | No automated retry for authentication/security failures; CAPTCHA causes a hard stop |

## Security gates before expansion

1. One EASI account reconciles exactly against the CDSL page.
2. Secret scanning finds no seeded test secret in logs, database, build, or artifacts.
3. Five accounts complete five business days without a silent parser error.
4. Owner revocation and credential rotation are exercised.
5. CDSL/DP permitted-use question is resolved before hosting centrally or serving unrelated users.
