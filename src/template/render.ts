import type { CommandResult } from "../control/CommandTypes.js";
import type { SessionState } from "../session/types.js";
import { renderEventLines } from "./fragments/events.js";
import {
  renderHistoryLines,
  type SessionObservationHistoryEntry,
} from "./fragments/history.js";
import {
  renderMemoryLines,
  type SessionObservationMemorySection,
} from "./fragments/memory.js";
import { renderSupervisorLines } from "./fragments/supervisor.js";
import { renderToolList, resolveTools } from "./fragments/tools.js";
import { renderTaggedSection } from "./tags.js";

export interface SessionObservationInput {
  readonly history?: readonly SessionObservationHistoryEntry[];
  readonly lastResult?: CommandResult;
  readonly memory?: readonly SessionObservationMemorySection[];
  readonly objective?: string;
  readonly sessionState: SessionState;
  readonly step?: number;
  readonly supervisorHint?: string;
}

export function renderSessionObservation(
  input: SessionObservationInput
): string {
  const { miniState, mode, phase } = input.sessionState;
  const toolNames = resolveTools(input.sessionState);
  const sections = [
    renderTaggedSection("SESSION", [
      `Mode: ${mode}`,
      `Phase: ${phase}`,
      `Step: ${input.step ?? 0}`,
      `MiniState: map=${miniState.mapId} y=${miniState.y} x=${miniState.x} readiness=${miniState.readiness.lockReasons.join(",") || "ready"}`,
      input.objective === undefined
        ? ""
        : `Objective: ${input.objective.trim()}`,
      input.lastResult === undefined
        ? ""
        : `Last result: ${input.lastResult.status}${input.lastResult.reason === undefined ? "" : `/${input.lastResult.reason}`}`,
    ]),
    renderTaggedSection("TOOLS", renderToolList(toolNames)),
    renderTaggedSection("EVENTS", renderEventLines(input.sessionState.events)),
    renderTaggedSection(
      "SUPERVISOR",
      renderSupervisorLines(input.supervisorHint)
    ),
    renderTaggedSection("MEMORY", renderMemoryLines(input.memory ?? [])),
    renderTaggedSection("HISTORY", renderHistoryLines(input.history ?? [])),
  ];

  return sections.filter((section) => section.length > 0).join("\n\n");
}

export type { SessionObservationHistoryEntry } from "./fragments/history.js";
export type { SessionObservationMemorySection } from "./fragments/memory.js";
