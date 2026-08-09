import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCdslLoginState,
  type CdslLoginObservation,
} from "../scripts/lib/cdsl-login-state";

const pending: CdslLoginObservation = {
  url: "https://web.cdslindia.com/myeasitoken/Home/Login",
  visibleOtpFields: 0,
  otpChallengeVisible: false,
  captchaVisible: false,
  sessionTimeoutVisible: false,
  activeSessionVisible: false,
  passwordExpiredVisible: false,
  errorText: "",
};

test("recognizes authenticated and OTP states without treating OTP URLs as authenticated", () => {
  assert.equal(
    classifyCdslLoginState({
      ...pending,
      url: "https://web.cdslindia.com/myeasitoken/Bo/Home",
    }),
    "authenticated",
  );
  assert.equal(
    classifyCdslLoginState({
      ...pending,
      url: "https://web.cdslindia.com/myeasitoken/Bo/OTPAuthentication",
      visibleOtpFields: 1,
    }),
    "otp",
  );
});

test("recognizes visible OTP challenges even when CDSL uses an unlabelled input", () => {
  assert.equal(
    classifyCdslLoginState({
      ...pending,
      otpChallengeVisible: true,
    }),
    "otp",
  );
});

test("recognizes CDSL active-session and sanitized login failures", () => {
  assert.equal(
    classifyCdslLoginState({
      ...pending,
      errorText: "ALREADY_SIGNED_IN",
    }),
    "active_session",
  );
  assert.equal(
    classifyCdslLoginState({
      ...pending,
      errorText: "Invalid Login Id / Password",
    }),
    "invalid_credentials",
  );
  assert.equal(
    classifyCdslLoginState({
      ...pending,
      errorText: "PASS_EXPIRED",
    }),
    "password_expired",
  );
  assert.equal(
    classifyCdslLoginState({
      ...pending,
      errorText: "USER_LOCKED",
    }),
    "account_locked",
  );
});

test("recognizes session-timeout redirects before waiting for OTP", () => {
  assert.equal(
    classifyCdslLoginState({
      ...pending,
      url: "https://web.cdslindia.com/myeasitoken/Error/SessionTimeout",
    }),
    "session_timeout",
  );
  assert.equal(
    classifyCdslLoginState({
      ...pending,
      sessionTimeoutVisible: true,
    }),
    "session_timeout",
  );
});

test("treats CDSL's forced password-change route as an expired password stop", () => {
  assert.equal(
    classifyCdslLoginState({
      ...pending,
      url: "https://web.cdslindia.com/myeasitoken/Home/ChangePassword",
    }),
    "password_expired",
  );
});

test("fails closed for CAPTCHA and multiple OTP challenges", () => {
  assert.equal(
    classifyCdslLoginState({ ...pending, captchaVisible: true }),
    "captcha",
  );
  assert.equal(
    classifyCdslLoginState({ ...pending, visibleOtpFields: 2 }),
    "multiple_otp",
  );
});
