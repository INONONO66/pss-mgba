export function renderSupervisorLines(hint: string | undefined): string[] {
  const normalized = hint?.trim();
  return normalized === undefined || normalized.length === 0
    ? ["- none"]
    : normalized
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}
