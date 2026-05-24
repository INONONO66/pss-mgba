import type { MgbaStatus } from "./mgba-http";
import type { PokemonStateObservation } from "./pokemon-state";

export const EVENTS_JSONL_FILENAME = "events.jsonl";
export const VIEWER_EVENT_SCHEMA_VERSION = 1;

export type ViewerEvent = ObservationViewerEvent | AgentViewerEvent;

export interface ObservationViewerEvent {
  pokemonState?: PokemonStateObservation;
  runId: string;
  schemaVersion: typeof VIEWER_EVENT_SCHEMA_VERSION;
  screenshot: ViewerEventScreenshot;
  status: MgbaStatus;
  timestamp: string;
  turn: number;
  type: "observation";
}

export interface AgentViewerEvent {
  runId: string;
  schemaVersion: typeof VIEWER_EVENT_SCHEMA_VERSION;
  summary?: ViewerEventSummary;
  timestamp: string;
  turn?: number;
  type: "agent-event";
}

export interface ViewerEventScreenshot {
  data: string;
  mediaType: "image/png";
  path?: string;
}

export type ViewerEventSummaryKind =
  | "action_plan"
  | "action_tool_call"
  | "action_tool_result"
  | "supervisor_intervention"
  | "assistant_text"
  | "assistant_reasoning"
  | "lifecycle"
  | "other";

export interface ViewerEventSummary {
  input?: unknown;
  kind: ViewerEventSummaryKind;
  output?: unknown;
  text?: string;
  toolCallId?: string;
  toolName?: string;
}
