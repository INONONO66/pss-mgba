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

export interface TurnTimelineEvent { sequence: number; type: string; timestamp?: string; toolCallId?: string; toolName?: string; isGameAction?: boolean; input?: unknown; output?: unknown; text?: string; message?: string; command?: Command; result?: unknown; [key: string]: unknown; }

export interface TurnRecord {
  version?: 1;
  turn: number;
  run?: { runId?: string; runner?: string; objective?: string; sessionKey?: string; maxTurns?: number; startedAt?: string; status?: string };
  fileName?: string;
  frame?: { before?: number; after?: number };
  startedAt?: string;
  finishedAt?: string;
  systemPrompt?: string;
  userPrompt?: string;
  reasoning?: string;
  response?: string;
  parsedCommand?: Command;
  rationale?: string;
  timeline?: TurnTimelineEvent[];
  toolCalls?: Array<{ toolCallId: string; toolName: string; input?: unknown; output?: unknown; isGameAction?: boolean }>;
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
  counts?: { turns?: number; screenshots?: number; errors?: number; [key: string]: number | undefined };
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

export type PersistedTileType = "walkable" | "wall" | "grass";
export interface PersistedTile { type?: PersistedTileType | string; tileId?: number; }
export interface PersistedWarp { y?: number; x?: number; destMapId?: number; destWarpId?: number; }
export interface PersistedMapRecord {
  mapId?: number;
  width?: number;
  height?: number;
  tiles?: Record<string, PersistedTile>;
  warps?: PersistedWarp[];
  connections?: Partial<Record<"north" | "south" | "east" | "west", number>>;
  [key: string]: unknown;
}
export interface MapMemoryResponse { runId: string; version?: number; updatedAt?: string; maps?: Record<string, PersistedMapRecord>; }
