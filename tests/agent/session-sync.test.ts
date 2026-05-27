import { describe, expect, it, vi } from "vitest";
import type {
  CommandAgentContext,
  CommandAgentGameState,
} from "../../src/agent/CommandAgentContext.js";
import { syncCommandAgentContext } from "../../src/agent/session-sync.js";
import { RED_BLUE_MEMORY_MAP } from "../../src/game/memoryMap.js";
import { RWY_ADDRESS } from "../../src/game/mode-classification.js";
import { createMiniState } from "../../src/session/mini-state-reader.js";
import type { InputResult } from "../../src/session/types.js";

const map = RED_BLUE_MEMORY_MAP;

function gameState(
  overrides: Partial<CommandAgentGameState> = {}
): CommandAgentGameState {
  return {
    fullState: {} as CommandAgentGameState["fullState"],
    mode: "battle",
    mapId: 1,
    playerY: 5,
    playerX: 4,
    facing: "down",
    mapWidth: 20,
    mapHeight: 18,
    warps: [],
    npcs: [],
    ...overrides,
  };
}

function createContext(state: CommandAgentGameState): CommandAgentContext {
  const executionContext = {
    mode: "battle",
    fullState: undefined as unknown as CommandAgentGameState["fullState"],
    inputGate: {
      press: vi.fn(async (button, frames) => inputResult(button, frames)),
    },
    mapWidth: 0,
    mapHeight: 0,
  } as unknown as CommandAgentContext["executionContext"];

  return {
    client: {
      read8(address: number): Promise<number> {
        if (address === map.wIsInBattle) {
          return Promise.resolve(0);
        }
        if (address === map.wTextBoxID) {
          return Promise.resolve(0);
        }
        if (address === map.wLetterPrintingDelayFlags) {
          return Promise.resolve(0);
        }
        if (address === map.wCurMap) {
          return Promise.resolve(1);
        }
        if (address === map.wPartyCount) {
          return Promise.resolve(1);
        }
        if (address === map.wWalkCounter) {
          return Promise.resolve(0);
        }
        if (address === map.wJoyIgnore) {
          return Promise.resolve(0);
        }
        if (address === map.wNamingScreenType) {
          return Promise.resolve(0);
        }
        if (address === RWY_ADDRESS) {
          return Promise.resolve(144);
        }
        return Promise.resolve(0);
      },
      readRange(address: number, length: number): Promise<Uint8Array> {
        if (address === map.wYCoord) {
          return Promise.resolve(Uint8Array.from([5, 4]));
        }
        return Promise.resolve(new Uint8Array(length));
      },
    },
    executionContext,
    readGameState: vi.fn(async () => state),
    updateMapMemory: vi.fn(async () => undefined),
    mapMemoryStore: { onUpdate: vi.fn() },
    updateMapGraph: vi.fn(),
    mapMemory: {},
    getLastWorld: () => ({ mode: "battle" }),
  } as unknown as CommandAgentContext;
}

function inputResult(
  button: InputResult["intent"]["button"],
  frames: number
): InputResult {
  const state = createMiniState({
    battle: 1,
    textBoxId: 0,
    letterDelay: 0,
    mapId: 1,
    y: 5,
    x: 4,
    partyCount: 1,
    walkCounter: 0,
    joyIgnore: 0,
    namingScreenType: 0,
    windowY: 144,
    screenText: "",
  });
  return {
    after: state,
    before: state,
    executed: true,
    intent: { button, frames, source: "test" },
    transition: { after: state, before: state, kind: "none" },
  };
}

describe("syncCommandAgentContext", () => {
  it("uses session mode authority and performs the single context sync path", async () => {
    const state = gameState({ mode: "battle", mapWidth: 40, mapHeight: 36 });
    const context = createContext(state);

    const result = await syncCommandAgentContext(context);

    expect(result.mode).toBe("overworld");
    expect(context.readGameState).toHaveBeenCalledTimes(1);
    expect(context.executionContext.mode).toBe("overworld");
    expect(context.executionContext.fullState).toBe(state.fullState);
    expect(context.executionContext.mapWidth).toBe(40);
    expect(context.executionContext.mapHeight).toBe(36);
    expect(context.updateMapMemory).toHaveBeenCalledTimes(1);
    expect(context.mapMemoryStore.onUpdate).toHaveBeenCalledWith(
      context.mapMemory
    );
    expect(context.updateMapGraph).toHaveBeenCalledTimes(1);
  });
});
