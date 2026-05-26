import type { AgentTool } from "@minpeter/pss-runtime";
import type {
  CommandAgentContext,
  CommandAgentGameState,
} from "../src/agent/CommandAgentContext.js";
import { createCommandTools } from "../src/agent/command-tools.js";
import { createMemoryTools } from "../src/agent/memory-tools.js";
import {
  createSaveLoadTools,
  type SaveLoadJournalEntry,
} from "../src/agent/saveload-tools.js";
import type { GameMode } from "../src/control/CommandTypes.js";
import type { MgbaButton } from "../src/mgba/MgbaTypes.js";

interface ToolCheckResult {
  readonly inputValid: boolean;
  readonly name: string;
  readonly output: unknown;
}

interface MemoryEntry {
  readonly content: string;
  readonly createdAt: string;
  readonly id: string;
}

const pressedButtons: Array<{
  readonly button: MgbaButton;
  readonly frames?: number;
}> = [];
const saveSlots: number[] = [];
const loadSlots: number[] = [];
const memoryEntries: MemoryEntry[] = [];

async function main(): Promise<void> {
  const results: ToolCheckResult[] = [];

  const overworldCommandTools = createCommandTools(
    createCommandContext("overworld")
  );
  results.push(
    await runTool("pokemon_wait", overworldCommandTools.pokemon_wait, {
      frames: 1,
    })
  );

  const dialogCommandTools = createCommandTools(createCommandContext("dialog"));
  results.push(
    await runTool("pokemon_wait:dialog", dialogCommandTools.pokemon_wait, {
      frames: 1,
    })
  );
  results.push(
    await runTool("pokemon_dialog", dialogCommandTools.pokemon_dialog, {
      action: { kind: "advance" },
    })
  );

  const memoryTools = createMemoryTools({
    read() {
      return memoryEntries;
    },
    async write(_section: string, content: string) {
      await Promise.resolve();
      const entry = {
        content,
        createdAt: new Date(0).toISOString(),
        id: `mem-${memoryEntries.length + 1}`,
      };
      memoryEntries.push(entry);
      return {
        entry,
        evicted: 0,
        section: "notes",
        totalEntries: memoryEntries.length,
      };
    },
  } as never);
  results.push(
    await runTool("pokemon_memory_write", memoryTools.pokemon_memory_write, {
      content: "tool smoke note",
      section: "notes",
    })
  );
  results.push(
    await runTool("pokemon_memory_read", memoryTools.pokemon_memory_read, {
      section: "notes",
    })
  );

  const journal: SaveLoadJournalEntry[] = [];
  const saveLoadTools = createSaveLoadTools(
    {
      loadStateSlot: async (slot: number) => {
        loadSlots.push(slot);
        await Promise.resolve();
      },
      saveStateSlot: async (slot: number) => {
        saveSlots.push(slot);
        await Promise.resolve();
      },
    } as never,
    () => "overworld",
    { journal }
  );
  results.push(
    await runTool("pokemon_save", saveLoadTools.pokemon_save, {
      label: "tool smoke",
      slot: 0,
    })
  );
  results.push(
    await runTool("pokemon_load", saveLoadTools.pokemon_load, { slot: 0 })
  );

  console.log(
    JSON.stringify({ loadSlots, pressedButtons, results, saveSlots }, null, 2)
  );
}

async function runTool(
  name: string,
  tool: unknown,
  input: Record<string, unknown>
): Promise<ToolCheckResult> {
  const agentTool = tool as AgentTool;
  const schema = agentTool.inputSchema as {
    safeParse(
      value: unknown
    ):
      | { success: true; data: unknown }
      | { success: false; error: { flatten(): unknown } };
  };
  const parsed = schema.safeParse(input);
  const output = parsed.success
    ? await agentTool.execute?.(input, {} as never)
    : parsed.error.flatten();
  return { inputValid: parsed.success, name, output };
}

function createCommandContext(mode: GameMode): CommandAgentContext {
  let dialogReads = 0;
  const state = gameState(mode);

  return {
    executionContext: {
      controller: {
        async pressButton(button: MgbaButton, frames?: number) {
          pressedButtons.push({ button, frames });
          await Promise.resolve();
        },
      },
      dialogStateReader: {
        async isChoiceActive() {
          await Promise.resolve();
          return false;
        },
        async isDialogActive() {
          await Promise.resolve();
          return dialogReads === 0;
        },
        async isWindowVisible() {
          await Promise.resolve();
          return dialogReads === 0;
        },
        async isInBattle() {
          await Promise.resolve();
          return false;
        },
        async isNamingScreenActive() {
          await Promise.resolve();
          return false;
        },
        async readCurrentMenuItem() {
          await Promise.resolve();
          return 0;
        },
        async readScreenText() {
          await Promise.resolve();
          return dialogReads++ === 0 ? "HELLO" : "";
        },
        async readTextBoxId() {
          await Promise.resolve();
          return dialogReads <= 1 ? 1 : 0;
        },
      },
      fullState: state.fullState,
      interactStateReader: {},
      mapHeight: state.mapHeight,
      mapWidth: state.mapWidth,
      mode,
      navigateMapSource: {},
      navigateWorldReader: {},
      sleep: async () => undefined,
    },
    mapGraph: { renderForLLM: () => "" },
    mapMemory: { renderMicro: () => "" },
    mapMemoryStore: {
      onUpdate() {
        return;
      },
    },
    readGameState: async () => state,
    updateMapGraph() {
      return;
    },
    updateMapMemory: async () => undefined,
  } as unknown as CommandAgentContext;
}

function gameState(mode: GameMode): CommandAgentGameState {
  return {
    facing: "down",
    fullState: {
      bag: [],
      battle: {
        inBattle: mode === "battle",
        type: mode === "battle" ? "wild" : "none",
      },
      dialog: {
        active: mode === "dialog",
        joyIgnore: mode === "dialog" ? 255 : 0,
        letterPrintingDelayFlags: 0,
        textBoxId: mode === "dialog" ? 1 : 0,
      },
      flags: {
        badges: { count: 0, names: [], obtained: [], raw: 0 },
        deliveredOaksParcel: false,
        hasOaksParcel: false,
        hasPokedex: false,
        pokedexOwned: 0,
        pokedexSeen: 0,
      },
      map: {
        height: 9,
        mapId: 0,
        mapName: "Pallet Town",
        tilesetId: 0,
        width: 10,
      },
      menuText: {
        currentMenuItem: 0,
        letterPrintingDelayFlags: 0,
        namingScreenNameLength: 0,
        namingScreenSubmitName: 0,
        namingScreenType: 0,
        screenText: mode === "dialog" ? "HELLO" : "",
        screenTextKind: mode === "dialog" ? "overworld_text" : "none",
        textBoxId: mode === "dialog" ? 1 : 0,
      },
      party: { count: 0, members: [] },
      player: {
        badges: { count: 0, names: [], obtained: [], raw: 0 },
        facing: { direction: "down", raw: 0 },
        money: 0,
        name: "RED",
        playTime: "0:00",
        position: { mapId: 0, x: 2, xBlock: 0, y: 3, yBlock: 0 },
        rivalName: "BLUE",
      },
    },
    mapHeight: 18,
    mapId: 0,
    mapWidth: 20,
    mode,
    npcs: [],
    playerX: 2,
    playerY: 3,
    warps: [],
  } as CommandAgentGameState;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
