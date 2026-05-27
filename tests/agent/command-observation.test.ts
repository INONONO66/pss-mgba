import { describe, expect, it } from "vitest";
import { buildAgentObservation, type AgentObservationState } from "../../src/agent/command-observation.js";
import type { AgentMemoryFile } from "../../src/agent/AgentMemoryStore.js";
import type { MapGraph } from "../../src/game/MapGraph.js";
import type { MapMemory } from "../../src/game/MapMemory.js";

function stubState(): AgentObservationState {
  return {
    fullState: {
      bag: [],
      battle: { enemy: undefined, inBattle: false, type: "none" },
      dialog: { active: false },
      flags: { badges: { count: 0, names: [] } },
      map: { mapId: 0, mapName: "Pallet Town" },
      menuText: { screenText: "" },
      party: { members: [] },
      player: { badges: { count: 0, names: [] }, facing: { direction: "down" }, position: { x: 2, y: 3 } },
    } as any,
    mode: "overworld",
    mapId: 0,
    playerY: 3,
    playerX: 2,
    facing: "down",
    mapWidth: 20,
    mapHeight: 18,
    warps: [],
    npcs: [],
  };
}

function stubMapMemory(): MapMemory {
  return {
    renderFullMap: () => "",
    renderMicro: () => "",
    tileAt: () => undefined,
  } as unknown as MapMemory;
}

function stubMapGraph(): MapGraph {
  return { renderForLLM: () => "" } as unknown as MapGraph;
}

function emptyMemory(): AgentMemoryFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    nextEntryId: 1,
    sections: {
      objectives: [],
      journal: [],
      notes: [],
      strategy: [],
      landmarks: [],
      lessons: [],
    },
  };
}

function populatedMemory(): AgentMemoryFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    nextEntryId: 4,
    sections: {
      objectives: [{ id: "mem-000001", createdAt: new Date().toISOString(), content: "Beat the Elite Four" }],
      journal: [
        { id: "mem-000002", createdAt: new Date().toISOString(), content: "Got starter Charmander" },
        { id: "mem-000003", createdAt: new Date().toISOString(), content: "Beat Brock" },
      ],
      notes: [],
      strategy: [
        {
          id: "mem-000004",
          createdAt: new Date().toISOString(),
          content: "Use Ember on grass types",
        },
      ],
      landmarks: [],
      lessons: [],
    },
  };
}

describe("buildAgentObservation memory injection", () => {
  it("includes [AGENT MEMORY] section when memory has entries", () => {
    const result = buildAgentObservation(stubState(), stubMapMemory(), stubMapGraph(), {
      agentMemory: populatedMemory(),
    });
    const text = result[0].type === "text" ? result[0].text : "";
    expect(text).toContain("[AGENT MEMORY]");
    expect(text).toContain("objectives:");
    expect(text).toContain("- Beat the Elite Four");
    expect(text).toContain("journal:");
    expect(text).toContain("- Got starter Charmander");
    expect(text).toContain("- Beat Brock");
    expect(text).toContain("strategy:");
    expect(text).toContain("- Use Ember on grass types");
    expect(text).not.toContain("notes:");
  });

  it("omits [AGENT MEMORY] section when memory is empty", () => {
    const result = buildAgentObservation(stubState(), stubMapMemory(), stubMapGraph(), {
      agentMemory: emptyMemory(),
    });
    const text = result[0].type === "text" ? result[0].text : "";
    expect(text).not.toContain("[AGENT MEMORY]");
  });

  it("omits [AGENT MEMORY] section when agentMemory is undefined", () => {
    const result = buildAgentObservation(stubState(), stubMapMemory(), stubMapGraph(), {});
    const text = result[0].type === "text" ? result[0].text : "";
    expect(text).not.toContain("[AGENT MEMORY]");
  });

  it("renders only non-empty sections", () => {
    const memory = emptyMemory();
    memory.sections.journal = [{ id: "mem-000001", createdAt: new Date().toISOString(), content: "Only journal entry" }];
    const result = buildAgentObservation(stubState(), stubMapMemory(), stubMapGraph(), {
      agentMemory: memory,
    });
    const text = result[0].type === "text" ? result[0].text : "";
    expect(text).toContain("[AGENT MEMORY]");
    expect(text).toContain("journal:");
    expect(text).toContain("- Only journal entry");
    expect(text).not.toContain("objectives:");
    expect(text).not.toContain("notes:");
    expect(text).not.toContain("strategy:");
  });
});

describe("buildAgentObservation dynamic milestones", () => {
  function getText(detectorStatus: unknown): string {
    const result = buildAgentObservation(stubState(), stubMapMemory(), stubMapGraph(), { detectorStatus });
    return result[0].type === "text" ? result[0].text : "";
  }

  it("shows next milestone for Stage 1 when starterAcquired is false", () => {
    const text = getText({
      status: "running",
      checkpoints: { initialObserved: true, starterAcquired: false, rivalBattleEntered: false, rivalBattleExited: false, completed: false },
    });
    expect(text).toContain("Next milestone: Obtain starter Pokemon");
    expect(text).toContain("Completed: Observe starting area");
  });

  it("shows next milestone for full-game with multiple completed", () => {
    const text = getText({
      status: "running",
      checkpoints: {
        initialObserved: true,
        starterAcquired: true,
        rivalBattleEntered: true,
        rivalBattleExited: true,
        badgesObserved: false,
        allBadgesObtained: false,
        hallOfFameObserved: false,
        hallOfFameCompleted: false,
        completed: false,
      },
    });
    expect(text).toContain("Next milestone: Observe first badge");
    expect(text).toContain("Completed: Observe starting area, Obtain starter Pokemon, Enter Rival battle, Complete Rival battle");
  });

  it("omits next milestone when all checkpoints are completed", () => {
    const text = getText({
      status: "completed",
      checkpoints: { initialObserved: true, starterAcquired: true, rivalBattleEntered: true, rivalBattleExited: true, completed: true },
    });
    expect(text).not.toContain("Next milestone:");
    expect(text).toContain("Completed:");
  });

  it("omits milestones when detectorStatus is undefined", () => {
    const text = getText(undefined);
    expect(text).not.toContain("Next milestone:");
    expect(text).not.toContain("Completed:");
  });

  it("falls back to raw checkpoint name for unknown keys", () => {
    const text = getText({
      status: "running",
      checkpoints: { customCheckpoint: false },
    });
    expect(text).toContain("Next milestone: customCheckpoint");
  });
});
