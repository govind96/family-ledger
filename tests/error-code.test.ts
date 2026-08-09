import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeErrorCode } from "../scripts/lib/error-code";

test("preserves explicit application error codes", () => {
  assert.equal(
    sanitizeErrorCode(new Error("LOGIN_FLOW_TIMED_OUT")),
    "LOGIN_FLOW_TIMED_OUT",
  );
});

test("categorizes Playwright failures without returning a lone capital letter", () => {
  assert.equal(
    sanitizeErrorCode(
      new Error("page.goto: Timeout 30000ms exceeded while loading CDSL"),
    ),
    "BROWSER_OPERATION_TIMED_OUT",
  );
  assert.equal(
    sanitizeErrorCode(new Error("page.goto: net::ERR_CONNECTION_RESET")),
    "CDSL_NETWORK_ERROR",
  );
  assert.equal(
    sanitizeErrorCode(new Error("Unexpected browser automation failure")),
    "SYNC_FAILED",
  );
});
