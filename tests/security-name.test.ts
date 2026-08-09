import assert from "node:assert/strict";
import test from "node:test";
import { displaySecurityName } from "../lib/security-name";

test("removes CDSL's instrument description from the displayed name", () => {
  assert.equal(
    displaySecurityName(
      "AIMTRON ELECTRONICS LIMITED # EQUITY SHARES",
    ),
    "AIMTRON ELECTRONICS LIMITED",
  );
});

test("leaves security names without a CDSL separator unchanged", () => {
  assert.equal(
    displaySecurityName("Nippon India ETF Nifty BeES"),
    "Nippon India ETF Nifty BeES",
  );
});

test("never turns a malformed separator-only value into an empty label", () => {
  assert.equal(displaySecurityName("# EQUITY SHARES"), "# EQUITY SHARES");
});
