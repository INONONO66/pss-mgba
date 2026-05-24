export type MgbaButton =
  | "A"
  | "B"
  | "Select"
  | "Start"
  | "Right"
  | "Left"
  | "Up"
  | "Down"
  | "R"
  | "L";

export interface MgbaStatus {
  activeButtons: MgbaButton[];
  frame: number | null;
  gameCode: string;
  gameTitle: string;
}

export type PokemonStateReadStatus = "available" | "unavailable";
export type PokemonDirection = "down" | "up" | "left" | "right" | "unknown";

export interface PokemonStateObservation {
  battle: boolean;
  battleResult: number | null;
  battleType: number | null;
  dialogueLike: boolean | "visual-fallback";
  direction: PokemonDirection;
  mapId: number | null;
  menuLike: boolean | "visual-fallback";
  position: {
    x: number | null;
    y: number | null;
  };
  readStatus: PokemonStateReadStatus;
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

export interface ObservationViewerEvent {
  pokemonState?: PokemonStateObservation;
  runId: string;
  schemaVersion: 1;
  screenshot: ViewerEventScreenshot;
  status: MgbaStatus;
  timestamp: string;
  turn: number;
  type: "observation";
}

export interface AgentViewerEvent {
  runId: string;
  schemaVersion: 1;
  summary?: ViewerEventSummary;
  timestamp: string;
  turn?: number;
  type: "agent-event";
}

export type ViewerEvent = ObservationViewerEvent | AgentViewerEvent;

export interface ViewerRun {
  avgTokensPerTurn?: number;
  experimentId?: string;
  hasEvents: boolean;
  hasTokenUsage: boolean;
  iteration?: number;
  milestone?: string;
  milestoneCurrent?: string;
  milestoneFurthest?: string;
  mode?: string;
  objective?: string;
  ramReadStatus?: string;
  runBudget?: string;
  runId: string;
  stateSource?: string;
  stuckEvents?: number;
  supervisorEnabled?: boolean;
  supervisorInterventions?: number;
  totalTokens?: TokenUsageSnapshot;
  turns?: number;
}

export interface TokenUsageSnapshot {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokens: number;
  noCacheTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  textTokens: number;
  totalTokens: number;
}

export type TokenUsageMetric =
  | {
      iteration: number;
      modelId: string;
      runId: string;
      schemaVersion: 1;
      step: number;
      timestamp: string;
      turn: number;
      type: "llm-step";
      usage: TokenUsageSnapshot;
    }
  | {
      iteration: number;
      runId: string;
      schemaVersion: 1;
      steps: number;
      timestamp: string;
      turn: number;
      type: "turn-summary";
      usage: TokenUsageSnapshot;
    };

export interface TurnTrace {
  actionPlans: ViewerEventSummary[];
  agentEvents: AgentViewerEvent[];
  observation?: ObservationViewerEvent;
  supervisorInterventions: ViewerEventSummary[];
  tokenSteps: Extract<TokenUsageMetric, { type: "llm-step" }>[];
  tokenSummary?: Extract<TokenUsageMetric, { type: "turn-summary" }>;
  toolCalls: ViewerEventSummary[];
  toolResults: ViewerEventSummary[];
  turn: number;
}
