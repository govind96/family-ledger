import assert from "node:assert/strict";
import test from "node:test";
import { safeTarget } from "../scripts/lib/cdsl-connector";

test("verbose diagnostics strip URL queries, fragments, credentials, and ports", () => {
  assert.equal(
    safeTarget(
      "https://example:secret@web.cdslindia.com:443/myeasitoken/Bo/Home?token=sensitive#private",
    ),
    "https://web.cdslindia.com/myeasitoken/Bo/Home",
  );
});

test("verbose diagnostics fail closed for malformed URLs", () => {
  assert.equal(safeTarget("not a URL"), "invalid-url");
});

test("verbose diagnostics redact identifier-shaped path segments", () => {
  assert.equal(
    safeTarget(
      "https://web.cdslindia.com/myeasitoken/Bo/1201234567890123/ABCDE1234F/details",
    ),
    "https://web.cdslindia.com/myeasitoken/Bo/:redacted/:redacted/details",
  );
});
