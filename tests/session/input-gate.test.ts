import { describe, expect, it, vi } from "vitest";
import { WINDOW_HIDDEN_Y } from "../../src/game/mode-classification.js";
import { InputGate } from "../../src/session/input-gate.js";
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
    windowY: overrides.windowY ?? WINDOW_HIDDEN_Y,
    screenText: overrides.screenText ?? "",
  });
  return { ...state, ...overrides, readiness: state.readiness };
}

function readerFrom(states: readonly MiniState[]) {
  let index = 0;
  return {
    read(): Promise<MiniState> {
      const state = states[Math.min(index, states.length - 1)];
      index += 1;
      return Promise.resolve(state);
    },
  };
}

function createGate(states: readonly MiniState[]) {
  const pressButton = vi.fn(async () => undefined);
  const gate = new InputGate({
    controller: { pressButton },
    reader: readerFrom(states),
    options: {
      pollIntervalMs: 0,
      sleep: async () => undefined,
      stableReadCount: 1,
    },
  });
  return { gate, pressButton };
}

describe("InputGate", () => {
  it("executes ready input as a before/after transaction and detects movement", async () => {
    const before = mini({ y: 5, x: 4 });
    const after = mini({ y: 5, x: 5 });
    const { gate, pressButton } = createGate([before, after]);

    const result = await gate.press("Right", 5, {
      reason: "test move",
      source: "test",
    });

    expect(pressButton).toHaveBeenCalledWith("Right", 5);
    expect(result.executed).toBe(true);
    expect(result.before).toBe(before);
    expect(result.after).toBe(after);
    expect(result.transition.kind).toBe("movement");
    expect(result.intent).toMatchObject({
      button: "Right",
      frames: 5,
      source: "test",
    });
    expect(result.event).toMatchObject({ kind: "input", phase: "input" });
  });

  it("rejects joy-ignore lock without executing input", async () => {
    const before = mini({ joyIgnore: 0xff });
    const { gate, pressButton } = createGate([before]);

    const result = await gate.press("A", 5, { source: "test" });

    expect(pressButton).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
    expect(result.reason).toBe("joy-ignore");
    expect(result.before).toBe(before);
    expect(result.after).toBe(before);
    expect(result.transition.kind).toBe("none");
  });

  it("rejects walk animation without executing input", async () => {
    const before = mini({ walkCounter: 2 });
    const { gate, pressButton } = createGate([before]);

    const result = await gate.press("Up", 5, { source: "test" });

    expect(pressButton).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
    expect(result.reason).toBe("walk-animation");
  });

  it("allows text-window advance buttons while dialog is visible", async () => {
    const dialog = mini({ mode: "dialog", windowY: 120 });
    const { gate, pressButton } = createGate([dialog, dialog]);

    const result = await gate.press("A", 5, { source: "test" });

    expect(pressButton).toHaveBeenCalledWith("A", 5);
    expect(result.executed).toBe(true);
    expect(result.intent.allowDialog).toBe(true);
    expect(result.after).toBe(dialog);
  });

  it("rejects dialog advance while joy-ignore is still active", async () => {
    const dialog = mini({ joyIgnore: 0xff, mode: "dialog", windowY: 120 });
    const { gate, pressButton } = createGate([dialog]);

    const result = await gate.press("A", 5, { source: "test" });

    expect(pressButton).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
    expect(result.reason).toBe("joy-ignore");
  });

  it("rejects non-dialog directional input while a text window is visible", async () => {
    const dialog = mini({ mode: "dialog", windowY: 120 });
    const { gate, pressButton } = createGate([dialog]);

    const result = await gate.press("Up", 5, { source: "test" });

    expect(pressButton).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
    expect(result.reason).toBe("text-window");
  });

  it("settles on dialog when explicitly allowed by the intent", async () => {
    const before = mini();
    const after = mini({ mode: "dialog", windowY: 120 });
    const { gate, pressButton } = createGate([before, after]);

    const result = await gate.press("A", 8, {
      allowDialog: true,
      source: "test",
    });

    expect(pressButton).toHaveBeenCalledWith("A", 8);
    expect(result.executed).toBe(true);
    expect(result.after).toBe(after);
    expect(result.intent.allowDialog).toBe(true);
  });

  it("times out instead of settling on dialog when the intent forbids dialog", async () => {
    const before = mini();
    const after = mini({ mode: "dialog", windowY: 120 });
    const pressButton = vi.fn(async () => undefined);
    const gate = new InputGate({
      controller: { pressButton },
      reader: readerFrom([before, after]),
      options: {
        pollIntervalMs: 0,
        settleTimeoutMs: 0,
        sleep: async () => undefined,
        stableReadCount: 1,
      },
    });

    const result = await gate.press("Right", 5, {
      allowDialog: false,
      source: "test",
    });

    expect(pressButton).toHaveBeenCalledWith("Right", 5);
    expect(result.executed).toBe(true);
    expect(result.reason).toBe("settle-timeout");
    expect(result.after).toBe(after);
  });
});
