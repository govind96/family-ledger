const APPLICATION_ERROR_CODE =
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?::[A-Z][A-Z0-9_]*)?$/;

export function sanitizeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";

  if (APPLICATION_ERROR_CODE.test(message)) return message;

  if (/\btimeout\b|timed out|time limit exceeded/i.test(message)) {
    return "BROWSER_OPERATION_TIMED_OUT";
  }
  if (/net::err_|network error|connection (?:reset|refused|closed)/i.test(message)) {
    return "CDSL_NETWORK_ERROR";
  }
  if (
    /target (?:page|context|browser).*closed|browser has been closed/i.test(
      message,
    )
  ) {
    return "BROWSER_CLOSED";
  }

  return "SYNC_FAILED";
}
