export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url?: { url?: string; detail?: string } };

export type Command =
  | { type: "navigate"; x?: number; y?: number }
  | { type: "interact"; direction?: string }
  | { type: "wait"; frames?: number }
  | { type: "raw"; inputs?: string[] }
  | { type: string; [key: string]: unknown };

export type Action =
  | { type: "press"; button?: string; frames?: number }
  | { type: "wait"; frames?: number }
  | { type: "sequence"; actions?: Action[] }
  | { type: string; [key: string]: unknown };

export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  isGameAction?: boolean;
}

export interface TurnTimelineEvent {
  sequence?: number;
  timestamp?: string;
  type: string;
  text?: string;
  message?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  result?: unknown;
  command?: unknown;
  isGameAction?: boolean;
  [key: string]: unknown;
}

export interface TurnRecord {
  turn: number;
  fileName?: string;
  startedAt?: string;
  finishedAt?: string;
  frame?: { before?: number; after?: number };
  run?: { status?: string; [key: string]: unknown };
  systemPrompt?: string;
  userPrompt?: string;
  reasoning?: string;
  response?: string;
  parsedCommand?: Command;
  rationale?: string;
  toolCalls?: ToolCallRecord[];
  timeline?: TurnTimelineEvent[];
  gameState?: { before?: unknown; after?: unknown };
  agentMemory?: unknown;
  mapAscii?: string;
  mapGraph?: string;
  detector?: unknown;
  history?: unknown[];
  error?: unknown;
}


export interface TurnsResponse { runId: string; limit: number; count: number; turns: TurnRecord[]; }

export interface GameStateSnapshot { fileName?: string; state?: unknown; step?: number; frame?: number; stateHash?: string; error?: unknown; [key: string]: unknown; }
export interface GameStateResponse { runId: string; limit: number; count: number; latest?: GameStateSnapshot; states: GameStateSnapshot[]; }

export interface RunSummary {
  runId: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  totalSteps?: number;
  finalFrame?: number;
  counts?: { decisions?: number; errors?: number; [key: string]: number | undefined };
  detectorStatus?: { status?: string; progressStep?: number; lastProgressStep?: number };
  lastAction?: { step?: number; frame?: number; command?: Command; action?: Action; confidence?: number; rationale?: string };
}

export interface AgentMemoryResponse {
  runId: string;
  updatedAt: string | null;
  sections: {
    objectives: Array<{ id: string; createdAt: string; content: string }>;
    journal: Array<{ id: string; createdAt: string; content: string }>;
    notes: Array<{ id: string; createdAt: string; content: string }>;
    strategy: Array<{ id: string; createdAt: string; content: string }>;
  };
}

interface SupervisorAssessment {
  state: "progressing" | "stuck" | "blocked" | "complete" | string;
  reasons?: readonly string[];
  repeatedActionCount?: number;
  stableLocationCount?: number;
}

interface SupervisorGoal {
  id: string;
  kind: string;
  title: string;
  status: "active" | "pending" | "complete" | string;
  priority: number;
  why: string;
  successCriteria: readonly string[];
}

export interface SupervisorPlan {
  version: 1;
  generatedAtStep?: number;
  assessment: SupervisorAssessment;
  activeGoal: SupervisorGoal;
  goals: readonly SupervisorGoal[];
  guidance: readonly string[];
  avoid: readonly string[];
  citations: readonly string[];
}

export interface SupervisorResponse {
  runId: string;
  plan: SupervisorPlan | null;
  assessment: SupervisorAssessment | null;
  activeGoal: SupervisorGoal | null;
  knowledgeBaseSize: number;
}

export interface PersistedNpc {
  slot?: number;
  pictureId?: number;
  mapY?: number;
  mapX?: number;
  movementType?: string;
  onScreen?: boolean;
  lastSeenTurn?: number;
}

export interface PersistedMapRecord {
  mapId?: number;
  name?: string;
  width?: number;
  height?: number;
  tiles?: Record<string, unknown>;
  knownNpcs?: PersistedNpc[];
  warps?: unknown[];
  connections?: Record<string, unknown>;
  playerPosition?: { y?: number; x?: number };
  [key: string]: unknown;
}

export interface MapMemoryResponse { runId: string; version?: number; updatedAt?: string; maps?: Record<string, PersistedMapRecord>; }

/* ── WebSocket protocol types ── */

export type GameButton = "A" | "B" | "Start" | "Select" | "Up" | "Down" | "Left" | "Right";

export type ServerMessage =
  | { type: "hello"; seq: number; runId: string; payload: { serverTime: string } }
  | { type: "snapshot"; seq: number; runId: string; payload: ViewerSnapshot }
  | { type: "turn:start"; seq: number; runId: string; payload: { turn: number; state: unknown } }
  | { type: "agent:event"; seq: number; runId: string; payload: { turn: number; event: TurnTimelineEvent } }
  | { type: "turn:recorded"; seq: number; runId: string; payload: TurnRecord }
  | { type: "summary:update"; seq: number; runId: string; payload: RunSummary }
  | { type: "memory:update"; seq: number; runId: string; payload: AgentMemoryResponse }
  | { type: "map:update"; seq: number; runId: string; payload: MapMemoryResponse }
  | { type: "game-state:update"; seq: number; runId: string; payload: GameStateResponse }
  | { type: "console:line"; seq: number; runId: string; payload: ConsoleEntry }
  | { type: "ack"; seq: number; runId: string; payload: { id: string } }
  | { type: "error"; seq: number; runId: string; payload: { message: string; id?: string } };

export interface ViewerSnapshot {
  summary: RunSummary | null;
  gameState: GameStateResponse | null;
  turns: TurnsResponse | null;
  memory: AgentMemoryResponse | null;
  mapMemory: MapMemoryResponse | null;
}

export interface ConsoleEntry {
  at: string;
  level: "info" | "warn" | "error" | "debug";
  text: string;
}

/* ── Viewer state (client-side store) ── */

type ConnectionStatus = "connecting" | "open" | "closed";

export interface ViewerState {
  connection: { status: ConnectionStatus; lastSeq: number; error?: string };
  summary: RunSummary | null;
  gameState: GameStateResponse | null;
  turns: TurnsResponse | null;
  memory: AgentMemoryResponse | null;
  mapMemory: MapMemoryResponse | null;
  console: ConsoleEntry[];
  activeTab: ViewerTab;
  selectedTurnFile?: string;
}

export type ViewerTab = "map" | "turns" | "battle" | "memory" | "console" | "supervisor";
