import type { RuntimeLlm, RuntimeLlmOutput } from "@minpeter/pss-runtime";
import {
  generateText,
  type AssistantModelMessage,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { buildSystemPrompt } from "../ai/PromptBuilder.js";
import type { GameMode } from "../control/CommandTypes.js";

const LLM_MAX_ATTEMPTS = 3;
const DEFAULT_HISTORY_MESSAGE_PAIRS = 20;

export type DynamicReasoningEffort =
  | "provider-default"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface DynamicLlmContext {
  mode: GameMode;
  reasoning?: DynamicReasoningEffort;
  systemPrompt?: string;
  tools?: ToolSet;
}

export interface CompactionOptions {
  readonly model: LanguageModel;
  readonly generateTextImpl?: typeof generateText;
  readonly maxSummaryTokens?: number;
}

export interface CompactionState {
  lastSummary: string | undefined;
  lastDiscardedCount: number;
}

export interface CreateDynamicLlmOptions {
  compaction?: CompactionOptions;
  generateTextImpl?: typeof generateText;
  getContext: () => DynamicLlmContext;
  maxHistoryMessagePairs?: number;
  model: LanguageModel;
  reasoning?: DynamicReasoningEffort;
  sleep?: (ms: number) => Promise<void>;
}

type ResponseMessage = RuntimeLlmOutput[number];

export function createDynamicLlm({
  compaction,
  generateTextImpl = generateText,
  getContext,
  maxHistoryMessagePairs = DEFAULT_HISTORY_MESSAGE_PAIRS,
  model,
  reasoning,
  sleep = defaultSleep,
}: CreateDynamicLlmOptions): RuntimeLlm {
  const compactionState: CompactionState = { lastSummary: undefined, lastDiscardedCount: 0 };

  return async ({ history, signal }) => {
    for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt += 1) {
      const context = getContext();
      const dynamicReasoning = context.reasoning ?? reasoning ?? "provider-default";

      try {
        const messages = compaction === undefined
          ? windowHistory(history, maxHistoryMessagePairs)
          : await compactHistory(history, maxHistoryMessagePairs, compaction, compactionState);

        const { responseMessages } = await generateTextImpl({
          abortSignal: signal,
          instructions: buildInstructions(context),
          messages,
          model,
          reasoning: dynamicReasoning,
          tools: context.tools,
        });

        return enforceSingleToolCall(responseMessages);
      } catch (error) {
        if (attempt >= LLM_MAX_ATTEMPTS || !isTransientLlmError(error)) {
          throw error;
        }
        await sleep(100 * 2 ** (attempt - 1));
      }
    }

    throw new Error("LLM retry loop exhausted unexpectedly");
  };
}

export function windowHistory(
  history: readonly ModelMessage[],
  maxHistoryMessagePairs = DEFAULT_HISTORY_MESSAGE_PAIRS,
): ModelMessage[] {
  const maxUnits = Math.max(1, Math.floor(maxHistoryMessagePairs) * 2);
  const units = toPairPreservingUnits(history);
  const windowed = units.slice(-maxUnits).flat();
  return removeOrphanToolParts(windowed);
}

export async function compactHistory(
  history: readonly ModelMessage[],
  maxHistoryMessagePairs: number,
  options: CompactionOptions,
  state: CompactionState = { lastSummary: undefined, lastDiscardedCount: 0 },
): Promise<ModelMessage[]> {
  const maxUnits = Math.max(1, Math.floor(maxHistoryMessagePairs) * 2);
  const units = toPairPreservingUnits(history);

  if (units.length <= maxUnits) {
    return removeOrphanToolParts(units.flat());
  }

  const discardedUnits = units.slice(0, -maxUnits);
  const keptUnits = units.slice(-maxUnits);
  const discardedMessages = discardedUnits.flat();

  if (discardedMessages.length !== state.lastDiscardedCount || state.lastSummary === undefined) {
    try {
      state.lastSummary = await generateCompactionSummary(discardedMessages, options);
      state.lastDiscardedCount = discardedMessages.length;
    } catch {
      return removeOrphanToolParts(keptUnits.flat());
    }
  }

  const summaryMessage: ModelMessage = {
    role: "user",
    content: [{ type: "text", text: `[COMPACTION SUMMARY — earlier conversation condensed]\n\n${state.lastSummary}` }],
  };

  return removeOrphanToolParts([summaryMessage, ...keptUnits.flat()]);
}

const COMPACTION_PROMPT = `Summarize this Pokemon game agent conversation history into a structured checkpoint.

Use this EXACT format:

## Goal
What the agent was trying to accomplish.

## Progress
What was accomplished, key milestones reached.

## Key Decisions
Important choices made (battle strategy, navigation, items used).

## Next Steps
What was planned or needed next.

## Critical Context
Map positions, Pokemon status, items, badges — facts needed to continue.

Be concise. Preserve exact map names, Pokemon names, and move names.`;

async function generateCompactionSummary(
  messages: readonly ModelMessage[],
  options: CompactionOptions,
): Promise<string> {
  const gen = options.generateTextImpl ?? generateText;
  const formatted = messages.map(formatMessageForSummary).join("\n");

  const { text } = await gen({
    model: options.model,
    messages: [{ role: "user", content: `${formatted}\n\n${COMPACTION_PROMPT}` }],
  });

  return text;
}

function formatMessageForSummary(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return `[${message.role}] ${message.content}`;
  }
  if (!Array.isArray(message.content)) {
    return `[${message.role}] ${JSON.stringify(message.content)}`;
  }
  const parts = message.content.map((part) => {
    const partRecord = part as Record<string, unknown>;
    if (partRecord.type === "text" && typeof partRecord.text === "string") {
      return partRecord.text;
    }
    if (partRecord.type === "tool-call") {
      return `[tool-call: ${partRecord.toolName}(${JSON.stringify(partRecord.input)})]`;
    }
    if (partRecord.type === "tool-result") {
      return `[tool-result: ${JSON.stringify(partRecord.result ?? partRecord.output ?? "")}]`;
    }
    return JSON.stringify(partRecord);
  });
  return `[${message.role}] ${parts.join(" ")}`;
}

export function enforceSingleToolCall(messages: readonly ResponseMessage[]): RuntimeLlmOutput {
  let allowedToolCallId: string | undefined;
  const filtered: ResponseMessage[] = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      const content = filterAssistantContent(message.content, allowedToolCallId, (toolCallId) => {
        allowedToolCallId = toolCallId;
      });
      filtered.push({ ...message, content });
      continue;
    }

    const content = message.content.filter((part) => {
      if (part.type !== "tool-result") {
        return true;
      }
      return allowedToolCallId !== undefined && part.toolCallId === allowedToolCallId;
    });

    if (content.length > 0) {
      filtered.push({ ...message, content });
    }
  }

  return filtered;
}

export function buildInstructions(context: DynamicLlmContext): string {
  const basePrompt = buildSystemPrompt(context.mode);
  const dynamicPrompt = context.systemPrompt?.trim();
  return dynamicPrompt === undefined || dynamicPrompt.length === 0
    ? basePrompt
    : `${basePrompt}\n\n${dynamicPrompt}`;
}

function toPairPreservingUnits(history: readonly ModelMessage[]): ModelMessage[][] {
  const units: ModelMessage[][] = [];
  let index = 0;

  while (index < history.length) {
    const message = history[index];
    if (message.role !== "assistant") {
      units.push([message]);
      index += 1;
      continue;
    }

    const toolCallIds = getAssistantToolCallIds(message);
    if (toolCallIds.length === 0) {
      units.push([message]);
      index += 1;
      continue;
    }

    const unit: ModelMessage[] = [message];
    const pendingToolCallIds = new Set(toolCallIds);
    index += 1;

    while (index < history.length && history[index].role === "tool") {
      const toolMessage = history[index];
      unit.push(toolMessage);
      for (const resultId of getToolResultIds(toolMessage)) {
        pendingToolCallIds.delete(resultId);
      }
      index += 1;
      if (pendingToolCallIds.size === 0) {
        break;
      }
    }

    units.push(unit);
  }

  return units;
}

function removeOrphanToolParts(messages: readonly ModelMessage[]): ModelMessage[] {
  const toolCallIds = new Set<string>();
  const toolResultIds = new Set<string>();

  for (const message of messages) {
    for (const toolCallId of getToolCallIds(message)) {
      toolCallIds.add(toolCallId);
    }
    for (const toolResultId of getToolResultIds(message)) {
      toolResultIds.add(toolResultId);
    }
  }

  const pairedToolCallIds = new Set(
    [...toolCallIds].filter((toolCallId) => toolResultIds.has(toolCallId)),
  );

  return messages.flatMap((message): ModelMessage[] => {
    if (message.role === "assistant") {
      const content = filterAssistantContent(message.content, undefined, undefined, pairedToolCallIds);
      return [{ ...message, content }];
    }

    if (message.role === "tool") {
      const content = message.content.filter(
        (part) => part.type !== "tool-result" || pairedToolCallIds.has(part.toolCallId),
      );
      return content.length === 0 ? [] : [{ ...message, content }];
    }

    return [message];
  });
}

function filterAssistantContent(
  content: AssistantModelMessage["content"],
  allowedToolCallId?: string,
  setAllowedToolCallId?: (toolCallId: string) => void,
  pairedToolCallIds?: ReadonlySet<string>,
): AssistantModelMessage["content"] {
  if (typeof content === "string") {
    return content;
  }

  return content.filter((part) => {
    if (part.type !== "tool-call") {
      return true;
    }

    if (pairedToolCallIds !== undefined) {
      return pairedToolCallIds.has(part.toolCallId);
    }

    if (allowedToolCallId !== undefined) {
      return part.toolCallId === allowedToolCallId;
    }

    setAllowedToolCallId?.(part.toolCallId);
    return true;
  });
}

function getToolCallIds(message: ModelMessage): string[] {
  if (message.role !== "assistant" || typeof message.content === "string") {
    return [];
  }

  return getAssistantToolCallIds(message);
}

function getAssistantToolCallIds(message: AssistantModelMessage): string[] {
  if (typeof message.content === "string") {
    return [];
  }

  return message.content.flatMap((part) => (part.type === "tool-call" ? [part.toolCallId] : []));
}

function getToolResultIds(message: ModelMessage): string[] {
  if (message.role !== "tool") {
    return [];
  }

  return message.content.flatMap((part) =>
    part.type === "tool-result" ? [part.toolCallId] : [],
  );
}

function isTransientLlmError(error: unknown): boolean {
  if (isAbortError(error)) {
    return false;
  }

  const status =
    readNumericProperty(error, "status") ??
    readNumericProperty(error, "statusCode");
  if (typeof status === "number") {
    return (
      status === 408 ||
      status === 409 ||
      status === 425 ||
      status === 429 ||
      status >= 500
    );
  }

  const code = readStringProperty(error, "code");
  return (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_SOCKET"
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function readNumericProperty(error: unknown, key: string): number | undefined {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return;
  }
  const value = error[key as keyof typeof error];
  return typeof value === "number" ? value : undefined;
}

function readStringProperty(error: unknown, key: string): string | undefined {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return;
  }
  const value = error[key as keyof typeof error];
  return typeof value === "string" ? value : undefined;
}
