import assert from "node:assert/strict";
import test from "node:test";
import { extractOtpFromText } from "../scripts/lib/gmail-otp";

test("extracts a labelled CDSL OTP without accepting unrelated numbers", () => {
  assert.equal(
    extractOtpFromText(
      "CDSL EASI login. Your one-time password is 481927. Helpline 18002009919.",
    ),
    "481927",
  );
});

test("extracts an OTP when the code appears before its label", () => {
  assert.equal(extractOtpFromText("736204 is your OTP for login."), "736204");
});

test("ignores an unlabelled number", () => {
  assert.equal(extractOtpFromText("CDSL reference 736204"), null);
});

test("rejects messages containing different labelled OTP candidates", () => {
  assert.throws(
    () => extractOtpFromText("OTP 736204. Previous OTP 552901."),
    /GMAIL_OTP_AMBIGUOUS/,
  );
});
