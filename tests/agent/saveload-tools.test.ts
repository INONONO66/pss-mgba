import { describe, expect, it, vi } from "vitest";
import { createSaveLoadTools, type SaveLoadJournalEntry } from "../../src/agent/saveload-tools.js";
import type { MgbaHttpClient } from "../../src/mgba/MgbaHttpClient.js";

describe("save/load tools", () => {
  it("guards all save/load actions to overworld mode", async () => {
    const client = createClient();
    const tools = createSaveLoadTools(client, () => "battle", { write: vi.fn() });

    await expect(executeTool(tools.pokemon_save, { slot: 1 })).rejects.toThrow("pokemon_save is disabled in battle mode");
    await expect(executeTool(tools.pokemon_load, { slot: 1 })).rejects.toThrow("pokemon_load is disabled in battle mode");
    await expect(executeTool(tools.pokemon_load_rollback, {})).rejects.toThrow("pokemon_load_rollback is disabled in battle mode");
    expect(client.saveStateSlot).not.toHaveBeenCalled();
    expect(client.loadStateSlot).not.toHaveBeenCalled();
  });

  it("validates that LLM-accessible save/load slots are 0 through 7 only", () => {
    const tools = createSaveLoadTools(createClient(), () => "overworld", { write: vi.fn() });

    expect(safeParse(tools.pokemon_save, { slot: 0, label: "start" }).success).toBe(true);
    expect(safeParse(tools.pokemon_save, { slot: 7 }).success).toBe(true);
    expect(safeParse(tools.pokemon_save, { slot: 8 }).success).toBe(false);
    expect(safeParse(tools.pokemon_load, { slot: 9 }).success).toBe(false);
    expect(safeParse(tools.pokemon_load, { slot: -1 }).success).toBe(false);
  });

  it("saves rollback slot 9 before loading and records journal through memory write", async () => {
    const client = createClient();
    const write = vi.fn(async (_section: string, _content: string) => undefined);
    const tools = createSaveLoadTools(client, () => "overworld", { write });

    const result = await executeTool(tools.pokemon_load, { slot: 3 });

    expect(result).toEqual({ action: "pokemon_load", mode: "overworld", ok: true, rollbackSlot: 9, slot: 3 });
    expect(client.saveStateSlot).toHaveBeenCalledWith(9);
    expect(client.loadStateSlot).toHaveBeenCalledWith(3);
    expect(client.saveStateSlot.mock.invocationCallOrder[0]).toBeLessThan(client.loadStateSlot.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe("journal");
    expect(JSON.parse(String(write.mock.calls[0]?.[1]))).toMatchObject({
      action: "pokemon_load",
      mode: "overworld",
      rollbackSlot: 9,
      schema: "pokemon.saveload.v1",
      sequence: 1,
      slot: 3,
      step: 1,
    } satisfies Partial<SaveLoadJournalEntry>);
  });

  it("records saves with labels and resets rollback cooldown progress", async () => {
    const client = createClient();
    const journal: SaveLoadJournalEntry[] = [];
    const tools = createSaveLoadTools(client, () => "overworld", { journal });

    const result = await executeTool(tools.pokemon_save, { slot: 2, label: "before Viridian" });

    expect(result).toEqual({ action: "pokemon_save", label: "before Viridian", mode: "overworld", ok: true, slot: 2 });
    expect(client.saveStateSlot).toHaveBeenCalledWith(2);
    expect(journal).toEqual([
      expect.objectContaining({
        action: "pokemon_save",
        label: "before Viridian",
        schema: "pokemon.saveload.v1",
        sequence: 1,
        slot: 2,
        step: 1,
      }),
    ]);
  });

  it("loads rollback slot 9 and blocks a second rollback inside cooldown", async () => {
    const client = createClient();
    const journal: SaveLoadJournalEntry[] = [];
    const tools = createSaveLoadTools(client, () => "overworld", { journal });

    const firstRollback = await executeTool(tools.pokemon_load_rollback, {});
    await expect(executeTool(tools.pokemon_load_rollback, {})).rejects.toThrow("cooldown active: 1 step(s) since last rollback, 10 required");

    expect(firstRollback).toEqual({
      action: "pokemon_load_rollback",
      consecutiveRollbacksWithoutProgress: 1,
      mode: "overworld",
      ok: true,
      slot: 9,
    });
    expect(client.loadStateSlot).toHaveBeenCalledTimes(1);
    expect(client.loadStateSlot).toHaveBeenCalledWith(9);
    expect(journal).toEqual([
      expect.objectContaining({
        action: "pokemon_load_rollback",
        consecutiveRollbacksWithoutProgress: 1,
        schema: "pokemon.saveload.v1",
        sequence: 1,
        slot: 9,
        step: 1,
      }),
    ]);
  });

  it("bases consecutive rollback protection on runner progress signals instead of save/load calls", async () => {
    const client = createClient();
    let progressToken = 0;
    const tools = createSaveLoadTools(client, () => "overworld", { journal: [] }, () => progressToken);

    await executeTool(tools.pokemon_load_rollback, {});
    await runSaveSteps(tools, 9);
    await executeTool(tools.pokemon_load_rollback, {});
    await runSaveSteps(tools, 9);
    await executeTool(tools.pokemon_load_rollback, {});
    await runSaveSteps(tools, 9);
    await expect(executeTool(tools.pokemon_load_rollback, {})).rejects.toThrow("3 consecutive rollbacks without agent progress");

    progressToken += 1;
    const afterProgress = await executeTool(tools.pokemon_load_rollback, {});

    expect(afterProgress).toMatchObject({
      action: "pokemon_load_rollback",
      consecutiveRollbacksWithoutProgress: 1,
      ok: true,
    });
  });
});

interface MockClient extends MgbaHttpClient {
  saveStateSlot: ((slot: number) => Promise<void>) & { mock: { invocationCallOrder: number[] } };
  loadStateSlot: ((slot: number) => Promise<void>) & { mock: { invocationCallOrder: number[] } };
}

interface ExecutableTool {
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

interface SchemaTool {
  inputSchema: { safeParse: (input: unknown) => { success: boolean } };
}

function createClient(): MockClient {
  return {
    loadStateSlot: vi.fn(async (_slot: number) => undefined),
    saveStateSlot: vi.fn(async (_slot: number) => undefined),
  } as unknown as MockClient;
}

async function executeTool(tool: unknown, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await (tool as ExecutableTool).execute(input);
  return result as Record<string, unknown>;
}

function safeParse(tool: unknown, input: unknown): { success: boolean } {
  return (tool as SchemaTool).inputSchema.safeParse(input);
}

async function runSaveSteps(tools: Record<string, unknown>, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await executeTool(tools.pokemon_save, { slot: index % 8 });
  }
}
