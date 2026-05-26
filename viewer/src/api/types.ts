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

export interface LlmConversation {
  call: number;
  model: string;
  temperature?: number;
  mode?: string;
  harnessMode?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string | ContentPart[] }>;
  responseContent?: string;
  parsedDecision?: { command?: Command; action?: Action; rationale?: string; confidence?: number; observedStateCitations?: string[] };
  error?: { code: string; message: string } | string;
  fileName?: string;
}

export interface LlmConversationsResponse { runId: string; limit: number; count: number; conversations: LlmConversation[]; }
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

export interface AgentMemoryEntry { id: string; createdAt: string; content: string; }
export interface AgentMemoryResponse {
  runId: string;
  updatedAt: string | null;
  sections: {
    objectives: AgentMemoryEntry[];
    journal: AgentMemoryEntry[];
    notes: AgentMemoryEntry[];
    strategy: AgentMemoryEntry[];
  };
}

export interface PersistedMapRecord {
  mapId?: number;
  name?: string;
  width?: number;
  height?: number;
  tiles?: Record<string, unknown>;
  npcPositions?: Array<{ y?: number; x?: number }>;
  warps?: unknown[];
  connections?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MapMemoryResponse { runId: string; version?: number; updatedAt?: string; maps?: Record<string, PersistedMapRecord>; }
