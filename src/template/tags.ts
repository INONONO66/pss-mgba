export function renderTaggedSection(
  tag: string,
  lines: readonly string[]
): string {
  const body = lines.filter((line) => line.trim().length > 0).join("\n");
  return body.length === 0 ? "" : `[${tag}]\n${body}`;
}
