import type { AgentTool, AgentTools } from "@minpeter/pss-runtime";
import { z } from "zod";
import {
  AGENT_MEMORY_MAX_ENTRIES_PER_SECTION,
  AGENT_MEMORY_MAX_ENTRY_CHARS,
  AGENT_MEMORY_SECTIONS,
  type AgentMemoryEntry,
  type AgentMemoryStore,
} from "./AgentMemoryStore.js";

const MEMORY_TOOL_RESULT_CHAR_LIMIT = 2000;
const MEMORY_ENTRY_CONTENT_CHAR_LIMIT = 220;

const memorySectionSchema = z.enum(AGENT_MEMORY_SECTIONS).describe(
  "Fixed agent memory section to read or write. Custom sections are not supported."
);

const memoryContentSchema = z
  .string()
  .trim()
  .min(1)
  .max(AGENT_MEMORY_MAX_ENTRY_CHARS)
  .describe(`Memory content to append. Maximum ${AGENT_MEMORY_MAX_ENTRY_CHARS} characters.`);

export function createMemoryTools(store: AgentMemoryStore): AgentTools {
  return {
    pokemon_memory_read: createMemoryReadTool(store),
    pokemon_memory_write: createMemoryWriteTool(store),
  } satisfies AgentTools;
}

function createMemoryReadTool(store: AgentMemoryStore): AgentTool {
  return {
    description:
      "Read one fixed Pokemon agent memory section: objectives, journal, notes, or strategy.",
    inputSchema: z.object({ section: memorySectionSchema }),
    execute: ({ section }) => {
      const entries = store.read(section);
      const cappedEntries = capMemoryEntries(entries);
      return {
        count: entries.length,
        entries: cappedEntries.map(toToolEntry),
        omittedEntries: entries.length - cappedEntries.length,
        outputLimitChars: MEMORY_TOOL_RESULT_CHAR_LIMIT,
        maxEntries: AGENT_MEMORY_MAX_ENTRIES_PER_SECTION,
        section,
        truncated: cappedEntries.length < entries.length || cappedEntries.some((entry) => entry.content.length < (entries.find((candidate) => candidate.id === entry.id)?.content.length ?? 0)),
      };
    },
  } satisfies AgentTool;
}

function createMemoryWriteTool(store: AgentMemoryStore): AgentTool {
  return {
    description:
      "Append concise information to one fixed Pokemon agent memory section. Older entries are evicted FIFO after 20 entries.",
    inputSchema: z.object({
      content: memoryContentSchema,
      section: memorySectionSchema,
    }),
    execute: async ({ content, section }) => {
      const result = await store.write(section, content);
      return {
        evicted: result.evicted,
        entry: toToolEntry(result.entry),
        maxEntries: AGENT_MEMORY_MAX_ENTRIES_PER_SECTION,
        ok: true,
        section: result.section,
        totalEntries: result.totalEntries,
      };
    },
  } satisfies AgentTool;
}

function toToolEntry(entry: AgentMemoryEntry): {
  readonly content: string;
  readonly createdAt: string;
  readonly id: string;
} {
  return {
    content: entry.content,
    createdAt: entry.createdAt,
    id: entry.id,
  };
}

function capMemoryEntries(entries: readonly AgentMemoryEntry[]): AgentMemoryEntry[] {
  let capped = entries.map((entry) => ({
    ...entry,
    content: truncate(entry.content, MEMORY_ENTRY_CONTENT_CHAR_LIMIT),
  }));

  while (serializedReadLength(capped, entries.length) > MEMORY_TOOL_RESULT_CHAR_LIMIT && capped.length > 0) {
    capped = capped.slice(1);
  }

  return capped;
}

function serializedReadLength(entries: readonly AgentMemoryEntry[], totalCount: number): number {
  return JSON.stringify({
    count: totalCount,
    entries: entries.map(toToolEntry),
    omittedEntries: totalCount - entries.length,
    outputLimitChars: MEMORY_TOOL_RESULT_CHAR_LIMIT,
    maxEntries: AGENT_MEMORY_MAX_ENTRIES_PER_SECTION,
    section: "objectives",
    truncated: entries.length < totalCount,
  }).length;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

export type { AgentMemorySection } from "./AgentMemoryStore.js";
export { MEMORY_TOOL_RESULT_CHAR_LIMIT as POKEMON_MEMORY_TOOL_RESULT_CHAR_LIMIT };
