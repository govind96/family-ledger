export type CdslLoginObservation = {
  url: string;
  visibleOtpFields: number;
  otpChallengeVisible: boolean;
  captchaVisible: boolean;
  sessionTimeoutVisible: boolean;
  activeSessionVisible: boolean;
  passwordExpiredVisible: boolean;
  errorText: string;
};

export type CdslLoginState =
  | "pending"
  | "authenticated"
  | "otp"
  | "multiple_otp"
  | "captcha"
  | "session_timeout"
  | "active_session"
  | "password_expired"
  | "account_locked"
  | "invalid_credentials"
  | "rejected";

export function classifyCdslLoginState(
  observation: CdslLoginObservation,
): CdslLoginState {
  const error = normalize(observation.errorText);
  const pathname = safePathname(observation.url);

  if (
    observation.sessionTimeoutVisible ||
    /\/myeasitoken\/error\/sessiontimeout(?:\/|$)/i.test(pathname) ||
    /session (?:has )?(?:expired|timed out)|session timeout/.test(error)
  ) {
    return "session_timeout";
  }

  if (
    observation.captchaVisible ||
    /not a robot|captcha|recaptcha/.test(error)
  ) {
    return "captcha";
  }
  if (
    observation.activeSessionVisible ||
    /already signed in|already logged in|active session/.test(error)
  ) {
    return "active_session";
  }
  if (
    observation.passwordExpiredVisible ||
    /\/myeasitoken\/home\/changepassword(?:\/|$)/i.test(pathname) ||
    /password (?:has )?expired|expired password|pass expired/.test(error)
  ) {
    return "password_expired";
  }
  if (
    /temporarily locked|account locked|user locked|maximum login attempts/.test(
      error,
    )
  ) {
    return "account_locked";
  }
  if (
    /invalid.*(?:user|login|password|credential)|incorrect.*(?:user|password)|authentication failed|login failed/.test(
      error,
    )
  ) {
    return "invalid_credentials";
  }
  if (observation.visibleOtpFields > 1) return "multiple_otp";
  if (observation.visibleOtpFields === 1 || observation.otpChallengeVisible) {
    return "otp";
  }

  if (
    /\/myeasitoken\/bo\//i.test(pathname) &&
    !/(?:otp|verify|auth)/i.test(pathname)
  ) {
    return "authenticated";
  }
  if (error) return "rejected";
  return "pending";
}

function normalize(value: string): string {
  return value.replaceAll("_", " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function safePathname(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return "";
  }
}
