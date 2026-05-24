const SECRET_KEY_PATTERN = /(["']?(?:OPENAI_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)["']?\s*[:=]\s*["']?)([^"'\s,}]+)/gi;
const OPENAI_SECRET_PATTERN = /sk-[A-Za-z0-9_-]+/g;
const INLINE_IMAGE_DATA_URL_PATTERN = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi;

export function redactSecrets(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return serialized
    .replace(INLINE_IMAGE_DATA_URL_PATTERN, "data:image/[redacted];base64,[REDACTED]")
    .replace(SECRET_KEY_PATTERN, "$1[REDACTED]")
    .replace(OPENAI_SECRET_PATTERN, "[REDACTED]");
}
