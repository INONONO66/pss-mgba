import { describe, expect, it, vi } from "vitest";
import {
  deriveSessionMemoryWrites,
  writeSessionMemoryEvents,
} from "../../src/agent/memory-events.js";
import { createMiniState } from "../../src/session/mini-state-reader.js";
import type { SessionEvent } from "../../src/session/types.js";

function mini(mapId: number, y = 1, x = 2) {
  return createMiniState({
    battle: 0,
    textBoxId: 0,
    letterDelay: 0,
    mapId,
    y,
    x,
    partyCount: 1,
    walkCounter: 0,
    joyIgnore: 0,
    namingScreenType: 0,
    windowY: 144,
    screenText: "",
  });
}

describe("session memory events", () => {
  it("derives map-transition landmarks and wall-collision lessons", async () => {
    const before = mini(1);
    const after = mini(2, 0, 0);
    const events: SessionEvent[] = [
      {
        kind: "transition",
        message: "Map changed",
        mode: "overworld",
        phase: "input",
        transition: {
          kind: "map",
          before,
          after,
          fromMapId: 1,
          toMapId: 2,
        },
      },
      {
        kind: "diagnostic",
        message: "Wall collision detected",
        metadata: { reason: "wall-collision" },
        miniState: before,
        mode: "overworld",
        phase: "input",
      },
      {
        kind: "input",
        message: "Input Up executed",
        metadata: { button: "Up", source: "agent" },
        miniState: before,
        mode: "overworld",
        phase: "input",
        transition: { kind: "none", before, after: before },
      },
    ];

    expect(deriveSessionMemoryWrites(events)).toEqual([
      {
        section: "landmarks",
        content: "Map transition observed: map 1 -> 2.",
      },
      {
        section: "lessons",
        content:
          "Wall collision at map 1 (1,2); choose a different direction or route around the obstacle.",
      },
      {
        section: "lessons",
        content:
          "Wall collision at map 1 (1,2); choose a different direction or route around the obstacle.",
      },
    ]);

    const store = { write: vi.fn(async () => ({}) as never) };
    await writeSessionMemoryEvents(store, events);

    expect(store.write).toHaveBeenCalledWith(
      "landmarks",
      "Map transition observed: map 1 -> 2."
    );
    expect(store.write).toHaveBeenCalledWith(
      "lessons",
      "Wall collision at map 1 (1,2); choose a different direction or route around the obstacle."
    );
  });
});
