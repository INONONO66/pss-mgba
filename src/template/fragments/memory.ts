export interface SessionObservationMemorySection {
  readonly entries: readonly string[];
  readonly name: string;
}

export function renderMemoryLines(
  memory: readonly SessionObservationMemorySection[]
): string[] {
  const lines = memory.flatMap((section) => {
    if (section.entries.length === 0) {
      return [];
    }
    return [
      `${section.name}:`,
      ...section.entries.map((entry) => `- ${entry}`),
    ];
  });
  return lines.length === 0 ? ["- none"] : lines;
}
