export interface SessionObservationHistoryEntry {
  readonly command: string;
  readonly result: string;
}

export function renderHistoryLines(
  history: readonly SessionObservationHistoryEntry[],
  limit = 5
): string[] {
  if (history.length === 0) {
    return ["- none"];
  }

  return history
    .slice(-limit)
    .map((entry) => `- ${entry.command} => ${entry.result}`);
}
