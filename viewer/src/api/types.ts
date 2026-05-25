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

export interface GameStateSnapshot { fileName?: string; state?: any; step?: number; frame?: number; stateHash?: string; error?: unknown; [key: string]: unknown; }
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

export interface RunEvent { sequence?: number; type: string; timestamp?: string; payload?: Record<string, unknown>; [key: string]: unknown; }
export interface EventsResponse { runId: string; limit: number; count: number; events: RunEvent[]; }
