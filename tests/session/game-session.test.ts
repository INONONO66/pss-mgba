import { describe, expect, it, vi } from "vitest";
import { GameSession } from "../../src/session/game-session.js";
import { createMiniState } from "../../src/session/mini-state-reader.js";
import type { MiniState } from "../../src/session/types.js";

function mini(overrides: Partial<MiniState> = {}): MiniState {
  const state = createMiniState({
    battle: overrides.battle ?? 0,
    textBoxId: overrides.textBoxId ?? 0,
    letterDelay: overrides.letterDelay ?? 0,
    mapId: overrides.mapId ?? 1,
    y: overrides.y ?? 5,
    x: overrides.x ?? 4,
    partyCount: overrides.partyCount ?? 1,
    walkCounter: overrides.walkCounter ?? 0,
    joyIgnore: overrides.joyIgnore ?? 0,
    namingScreenType: overrides.namingScreenType ?? 0,
    windowY: overrides.windowY ?? 144,
    screenText: overrides.screenText ?? "",
  });
  return { ...state, ...overrides, readiness: state.readiness };
}

describe("GameSession", () => {
  it("syncs full state from authoritative MiniState mode", async () => {
    const onSync = vi.fn();
    const fullState = { mapId: 1 };
    const session = new GameSession({
      miniStateReader: { read: async () => mini({ mode: "overworld" }) },
      fullStateReader: { read: async () => ({ value: fullState }) },
      onSync,
    });

    const result = await session.syncFullState();

    expect(result.fullState).toBe(fullState);
    expect(result.sessionState.mode).toBe("overworld");
    expect(result.sessionState.phase).toBe("synced");
    expect(onSync).toHaveBeenCalledWith(result);
  });

  it("records raw mode disagreement as diagnostics without changing authority", async () => {
    const session = new GameSession({
      miniStateReader: { read: async () => mini({ mode: "overworld" }) },
      fullStateReader: {
        read: async () => ({ value: { ok: true }, evidenceMode: "battle" }),
      },
    });

    const result = await session.syncFullState();

    expect(result.sessionState.mode).toBe("overworld");
    expect(result.sessionState.events).toHaveLength(1);
    expect(result.sessionState.events[0]).toMatchObject({
      kind: "mode-mismatch",
      mode: "overworld",
      metadata: {
        authoritativeMode: "overworld",
        evidenceMode: "battle",
        evidenceSource: "full-state-reader",
      },
    });
  });
});
