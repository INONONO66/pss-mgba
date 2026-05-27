import type { SessionEvent } from "../../session/types.js";

export function renderEventLines(
  events: readonly SessionEvent[],
  limit = 8
): string[] {
  if (events.length === 0) {
    return ["- none"];
  }

  return events.slice(-limit).map((event) => {
    const transition = event.transition;
    const suffix =
      transition === undefined ? "" : ` transition=${transition.kind}`;
    return `- ${event.kind}/${event.phase}/${event.mode}: ${event.message}${suffix}`;
  });
}
