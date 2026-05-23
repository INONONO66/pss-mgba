const SECRET_KEY_PATTERN = /(["']?(?:OPENAI_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|CREDENTIAL)["']?\s*[:=]\s*["']?)([^"',}\n]+)/gi;
const OPENAI_SECRET_PATTERN = /sk-[A-Za-z0-9_-]+/g;

export function redactSecrets(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return serialized
    .replace(SECRET_KEY_PATTERN, "$1[REDACTED]")
    .replace(OPENAI_SECRET_PATTERN, "[REDACTED]");
}
