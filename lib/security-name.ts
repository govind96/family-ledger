/**
 * CDSL appends the instrument description after a `#` separator. Keep the
 * source value intact in storage and exports, but omit that suffix in the UI.
 */
export function displaySecurityName(value: string): string {
  const normalized = value.trim();
  const separatorIndex = normalized.indexOf("#");
  if (separatorIndex < 0) return normalized;

  const issuerName = normalized.slice(0, separatorIndex).trim();
  return issuerName || normalized;
}
