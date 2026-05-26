import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_MEMORY_MAX_ENTRIES_PER_SECTION,
  AGENT_MEMORY_MAX_ENTRY_CHARS,
  AgentMemoryStore,
} from "../../src/agent/AgentMemoryStore.js";
import { createMemoryTools } from "../../src/agent/memory-tools.js";

describe("agent memory tools and store", () => {
  let tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
    tempDirs = [];
  });

  it("writes through the tool, persists atomically, and reads entries after reload", async () => {
    const filePath = await tempMemoryFile();
    const store = new AgentMemoryStore({ filePath, now: fixedNow });
    await store.load();
    const tools = createMemoryTools(store);

    const writeResult = await executeTool(tools.pokemon_memory_write, { section: "journal", content: "Met Oak in Pallet Town." });
    const readResult = await executeTool(tools.pokemon_memory_read, { section: "journal" });
    const reloaded = new AgentMemoryStore({ filePath, now: fixedNow });
    await reloaded.load();

    expect(writeResult).toMatchObject({
      evicted: 0,
      ok: true,
      section: "journal",
      totalEntries: 1,
      entry: { id: "mem-000001", content: "Met Oak in Pallet Town.", createdAt: fixedNow().toISOString() },
    });
    expect(readResult).toMatchObject({
      count: 1,
      maxEntries: AGENT_MEMORY_MAX_ENTRIES_PER_SECTION,
      section: "journal",
      entries: [{ id: "mem-000001", content: "Met Oak in Pallet Town." }],
    });
    expect(reloaded.read("journal").map((entry) => entry.content)).toEqual(["Met Oak in Pallet Town."]);
    expect(await readFile(filePath, "utf8")).toContain("Met Oak in Pallet Town.");
  });

  it("evicts journal entries FIFO after the per-section limit", async () => {
    const store = new AgentMemoryStore({ filePath: await tempMemoryFile(), now: fixedNow });
    await store.load();

    let lastWrite: Awaited<ReturnType<AgentMemoryStore["write"]>> | undefined;
    for (let index = 1; index <= AGENT_MEMORY_MAX_ENTRIES_PER_SECTION + 1; index += 1) {
      lastWrite = await store.write("journal", `entry-${index}`);
    }

    const entries = store.read("journal");
    expect(lastWrite).toMatchObject({ evicted: 1, totalEntries: AGENT_MEMORY_MAX_ENTRIES_PER_SECTION });
    expect(entries).toHaveLength(AGENT_MEMORY_MAX_ENTRIES_PER_SECTION);
    expect(entries[0]?.content).toBe("entry-2");
    expect(entries.at(-1)?.content).toBe("entry-21");
  });

  it("enforces 500-character size limits in schemas and store writes", async () => {
    const store = new AgentMemoryStore({ filePath: await tempMemoryFile(), now: fixedNow });
    await store.load();
    const writeTool = createMemoryTools(store).pokemon_memory_write;

    expect(safeParse(writeTool, { section: "notes", content: "x".repeat(AGENT_MEMORY_MAX_ENTRY_CHARS) }).success).toBe(true);
    expect(safeParse(writeTool, { section: "notes", content: "x".repeat(AGENT_MEMORY_MAX_ENTRY_CHARS + 1) }).success).toBe(false);
    await expect(store.write("notes", "x".repeat(AGENT_MEMORY_MAX_ENTRY_CHARS + 1))).rejects.toThrow("exceeds 500 characters");
  });

  it("caps memory read tool payloads near the global 2K result guardrail", async () => {
    const store = new AgentMemoryStore({ filePath: await tempMemoryFile(), now: fixedNow });
    await store.load();
    for (let index = 1; index <= AGENT_MEMORY_MAX_ENTRIES_PER_SECTION; index += 1) {
      await store.write("strategy", `${index}: ${"x".repeat(AGENT_MEMORY_MAX_ENTRY_CHARS - 4)}`);
    }
    const tools = createMemoryTools(store);

    const readResult = await executeTool(tools.pokemon_memory_read, { section: "strategy" });

    expect(JSON.stringify(readResult).length).toBeLessThanOrEqual(2100);
    expect(readResult).toMatchObject({
      count: AGENT_MEMORY_MAX_ENTRIES_PER_SECTION,
      outputLimitChars: 2000,
      section: "strategy",
      truncated: true,
    });
    expect(Number(readResult.omittedEntries)).toBeGreaterThan(0);
  });

  async function tempMemoryFile(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pss-agent-memory-"));
    tempDirs.push(dir);
    return path.join(dir, "agent-memory.json");
  }
});

interface ExecutableTool {
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

interface SchemaTool {
  inputSchema: { safeParse: (input: unknown) => { success: boolean } };
}

async function executeTool(tool: unknown, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await (tool as ExecutableTool).execute(input);
  return result as Record<string, unknown>;
}

function safeParse(tool: unknown, input: unknown): { success: boolean } {
  return (tool as SchemaTool).inputSchema.safeParse(input);
}

function fixedNow(): Date {
  return new Date("2026-05-26T00:00:00.000Z");
}
