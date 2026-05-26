import { describe, expect, it, vi } from "vitest";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import type { RuntimeLlmOutput } from "@minpeter/pss-runtime";
import {
  compactHistory,
  createDynamicLlm,
  enforceSingleToolCall,
  windowHistory,
  type CompactionState,
  type CreateDynamicLlmOptions,
  type DynamicLlmContext,
} from "../../src/agent/dynamic-llm.js";

describe("dynamic LLM wrapper", () => {
  it("keeps assistant tool calls paired with their tool results while trimming history", () => {
    const history: ModelMessage[] = [
      userMessage("old user"),
      assistantToolCallMessage("call-old", "pokemon_wait"),
      toolResultMessage("call-old", "old result"),
      userMessage("kept user"),
      assistantToolCallMessage("call-kept", "pokemon_navigate"),
      toolResultMessage("call-kept", "arrived"),
      userMessage("latest user"),
    ];

    const windowed = windowHistory(history, 1);

    expect(windowed.map((message) => message.role)).toEqual(["assistant", "tool", "user"]);
    expect(getToolCallIds(windowed[0])).toEqual(["call-kept"]);
    expect(getToolResultIds(windowed[1])).toEqual(["call-kept"]);
    expect(windowed).not.toContain(history[1]);
    expect(windowed).not.toContain(history[2]);
  });

  it("drops orphaned tool results and tool calls after windowing", () => {
    const history: ModelMessage[] = [
      assistantToolCallMessage("orphan-call", "pokemon_wait"),
      userMessage("middle"),
      toolResultMessage("orphan-result", "late result"),
    ];

    const windowed = windowHistory(history, 10);

    expect(windowed).toHaveLength(2);
    expect(getToolCallIds(windowed[0])).toEqual([]);
    expect(windowed[1]?.role).toBe("user");
  });

  it("enforces a single tool call and matching result per response", () => {
    const filtered = enforceSingleToolCall([
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll act once." },
          toolCallPart("first", "pokemon_wait"),
        ],
      },
      {
        role: "assistant",
        content: [toolCallPart("second", "pokemon_navigate")],
      },
      {
        role: "tool",
        content: [
          toolResultPart("second", "ignored"),
          toolResultPart("first", "kept"),
        ],
      },
    ] as RuntimeLlmOutput);

    expect(getToolCallIds(filtered[0])).toEqual(["first"]);
    expect(getToolCallIds(filtered[1])).toEqual([]);
    expect(getToolResultIds(filtered[2])).toEqual(["first"]);
  });

  it("drops extra tool calls from the same assistant message", () => {
    const filtered = enforceSingleToolCall([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Two actions attempted." },
          toolCallPart("first", "pokemon_wait"),
          toolCallPart("second", "pokemon_navigate"),
        ],
      },
      {
        role: "tool",
        content: [
          toolResultPart("second", "ignored"),
          toolResultPart("first", "kept"),
        ],
      },
    ] as RuntimeLlmOutput);

    expect(getToolCallIds(filtered[0])).toEqual(["first"]);
    expect(getToolResultIds(filtered[1])).toEqual(["first"]);
  });


  it("keeps auxiliary memory calls while enforcing one game action", () => {
    const filtered = enforceSingleToolCall([
      {
        role: "assistant",
        content: [
          toolCallPart("memory", "pokemon_memory_write"),
          toolCallPart("wait", "pokemon_wait"),
          toolCallPart("navigate", "pokemon_navigate"),
        ],
      },
      {
        role: "tool",
        content: [
          toolResultPart("memory", "memory kept"),
          toolResultPart("navigate", "ignored"),
          toolResultPart("wait", "wait kept"),
        ],
      },
    ] as RuntimeLlmOutput);

    expect(getToolCallIds(filtered[0])).toEqual(["memory", "wait"]);
    expect(getToolResultIds(filtered[1])).toEqual(["memory", "wait"]);
  });

  it("uses the latest mode, tools, prompt, and reasoning for each invocation", async () => {
    const contexts: DynamicLlmContext[] = [
      { mode: "overworld", reasoning: "low", tools: toolSet("pokemon_navigate") },
      { mode: "battle", systemPrompt: "Prefer safe battle actions.", tools: toolSet("pokemon_battle") },
    ];
    const generateTextMock = vi.fn(async (_options: GenerateTextCall) => ({ responseMessages: [] }));
    const generateTextImpl = generateTextMock as unknown as NonNullable<CreateDynamicLlmOptions["generateTextImpl"]>;
    const llm = createDynamicLlm({
      generateTextImpl,
      getContext: () => contexts.shift() ?? { mode: "dialog" },
      model: {} as LanguageModel,
      reasoning: "medium",
    });

    await llm({ history: [userMessage("first")], signal: new AbortController().signal });
    await llm({ history: [userMessage("second")], signal: new AbortController().signal });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(generateTextMock.mock.calls[0]?.[0]).toMatchObject({
      messages: [userMessage("first")],
      reasoning: "low",
      tools: toolSet("pokemon_navigate"),
    });
    expect(generateTextMock.mock.calls[1]?.[0]).toMatchObject({
      messages: [userMessage("second")],
      reasoning: "medium",
      tools: toolSet("pokemon_battle"),
    });
    const firstInstructions = String(generateTextMock.mock.calls[0]?.[0].instructions);
    const secondInstructions = String(generateTextMock.mock.calls[1]?.[0].instructions);
    expect(firstInstructions).not.toBe(secondInstructions);
    expect(secondInstructions).toContain("Prefer safe battle actions.");
  });
});

describe("compactHistory", () => {
  it("returns unchanged messages when history fits within window", async () => {
    const history: ModelMessage[] = [userMessage("hello"), userMessage("world")];
    const result = await compactHistory(history, 10, { model: {} as LanguageModel });
    expect(result).toEqual(history);
  });

  it("injects compaction summary when history exceeds window", async () => {
    const mockGenerate = vi.fn(async () => ({ text: "## Goal\nTest goal" }));
    const history: ModelMessage[] = [
      userMessage("old-1"),
      userMessage("old-2"),
      userMessage("old-3"),
      userMessage("kept"),
    ];
    const result = await compactHistory(history, 1, {
      model: {} as LanguageModel,
      generateTextImpl: mockGenerate as never,
    });
    expect(result[0].role).toBe("user");
    const firstContent = Array.isArray(result[0].content) ? result[0].content[0] : result[0].content;
    const text = typeof firstContent === "string" ? firstContent : (firstContent as { text: string }).text;
    expect(text).toContain("[COMPACTION SUMMARY");
    expect(text).toContain("Test goal");
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("caches summary and does not re-invoke LLM when discarded count unchanged", async () => {
    const mockGenerate = vi.fn(async () => ({ text: "cached summary" }));
    const history: ModelMessage[] = [userMessage("old"), userMessage("old2"), userMessage("kept")];
    const state: CompactionState = { lastSummary: undefined, lastDiscardedCount: 0 };

    await compactHistory(history, 1, { model: {} as LanguageModel, generateTextImpl: mockGenerate as never }, state);
    await compactHistory(history, 1, { model: {} as LanguageModel, generateTextImpl: mockGenerate as never }, state);

    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("falls back to plain windowed history when summarization fails", async () => {
    const mockGenerate = vi.fn(() => Promise.reject(new Error("LLM failed")));
    const history: ModelMessage[] = [userMessage("old"), userMessage("old2"), userMessage("kept")];
    const result = await compactHistory(history, 1, {
      model: {} as LanguageModel,
      generateTextImpl: mockGenerate as never,
    });
    expect(result.every((message) => message.role === "user")).toBe(true);
    expect(result).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining("COMPACTION") }),
    ]));
  });
});

function userMessage(text: string): ModelMessage {
  return { role: "user", content: text };
}

function assistantToolCallMessage(toolCallId: string, toolName: string): ModelMessage {
  return {
    role: "assistant",
    content: [toolCallPart(toolCallId, toolName)],
  } as ModelMessage;
}

function toolResultMessage(toolCallId: string, result: string): ModelMessage {
  return {
    role: "tool",
    content: [toolResultPart(toolCallId, result)],
  } as ModelMessage;
}

function toolCallPart(toolCallId: string, toolName: string): Record<string, unknown> {
  return { type: "tool-call", toolCallId, toolName, input: {} };
}

function toolResultPart(toolCallId: string, result: string): Record<string, unknown> {
  return { type: "tool-result", toolCallId, toolName: "pokemon_tool", result };
}

function getToolCallIds(message: unknown): string[] {
  const content = Array.isArray((message as { content?: unknown }).content)
    ? ((message as { content: unknown[] }).content)
    : [];
  return content.flatMap((part) =>
    (part as { type?: string; toolCallId?: string }).type === "tool-call"
      ? [(part as { toolCallId: string }).toolCallId]
      : []
  );
}

function getToolResultIds(message: unknown): string[] {
  const content = Array.isArray((message as { content?: unknown }).content)
    ? ((message as { content: unknown[] }).content)
    : [];
  return content.flatMap((part) =>
    (part as { type?: string; toolCallId?: string }).type === "tool-result"
      ? [(part as { toolCallId: string }).toolCallId]
      : []
  );
}

function toolSet(name: string): ToolSet {
  return {
    [name]: {
      description: name,
      inputSchema: {} as never,
    },
  } as ToolSet;
}

interface GenerateTextCall {
  instructions?: unknown;
  messages?: unknown;
  reasoning?: unknown;
  tools?: unknown;
}
