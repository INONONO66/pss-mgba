import { describe, expect, it, vi } from "vitest";
import { WINDOW_HIDDEN_Y } from "../../src/game/mode-classification.js";
import { AutoHandler } from "../../src/session/auto-handler.js";
import { createMiniState } from "../../src/session/mini-state-reader.js";
import type {
  InputIntent,
  InputResult,
  MiniState,
} from "../../src/session/types.js";

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

function inputResult(
  before: MiniState,
  after: MiniState,
  intent: InputIntent
): InputResult {
  return {
    before,
    after,
    executed: true,
    intent,
    transition: {
      kind: before.mode === after.mode ? "none" : "mode",
      before,
      after,
    },
  };
}

function createHarness(
  states: readonly MiniState[],
  options: {
    choice?: boolean;
    enemyDefeated?: boolean;
    naming?: boolean;
    partyWiped?: boolean;
  } = {}
) {
  let readIndex = 0;
  let pressIndex = 0;
  const presses: InputIntent[] = [];
  const stateReader = {
    read(): Promise<MiniState> {
      const state = states[Math.min(readIndex, states.length - 1)];
      readIndex += 1;
      return Promise.resolve(state);
    },
  };
  const inputGate = {
    press: vi.fn((button, frames, intentOptions) => {
      const before = states[Math.min(pressIndex, states.length - 1)];
      if (
        before.readiness.joyIgnore !== 0 ||
        before.readiness.walkCounter !== 0
      ) {
        const intent = {
          button,
          frames,
          allowDialog: intentOptions?.allowDialog,
          reason: intentOptions?.reason,
          source: intentOptions?.source ?? "auto",
        } satisfies InputIntent;
        return Promise.resolve({
          before,
          after: before,
          executed: false,
          intent,
          reason:
            before.readiness.joyIgnore === 0 ? "walk-animation" : "joy-ignore",
          transition: { kind: "none", before, after: before },
        } satisfies InputResult);
      }
      pressIndex += 1;
      const after = states[Math.min(pressIndex, states.length - 1)];
      const intent = {
        button,
        frames,
        allowDialog: intentOptions?.allowDialog,
        reason: intentOptions?.reason,
        source: intentOptions?.source ?? "auto",
      } satisfies InputIntent;
      presses.push(intent);
      return Promise.resolve(inputResult(before, after, intent));
    }),
  };
  const handler = new AutoHandler({
    dialogReader: {
      isChoiceActive: vi.fn(async () => options.choice ?? false),
      isNamingScreenActive: vi.fn(async () => options.naming ?? false),
    },
    inputGate,
    battleReader: {
      isEnemyDefeated: vi.fn(async () => options.enemyDefeated ?? false),
      isPartyWiped: vi.fn(async () => options.partyWiped ?? false),
    },
    stateReader,
    options: {
      battleExitPresses: 3,
      dialogHiddenConfirmCount: 2,
      dialogPresses: 5,
      postBattleDialogRounds: 5,
      postWarpDialogRounds: 5,
      lockPolls: 3,
      lockPollIntervalMs: 0,
      sleep: async () => undefined,
    },
  });
  return { handler, inputGate, presses };
}

describe("AutoHandler", () => {
  it("advances ordinary dialog with InputGate until two hidden reads", async () => {
    const dialog = mini({ mode: "dialog", screenText: "Hello", windowY: 120 });
    const hiddenOnce = mini({ mode: "overworld", windowY: WINDOW_HIDDEN_Y });
    const hiddenTwice = mini({ mode: "overworld", windowY: WINDOW_HIDDEN_Y });
    const { handler, inputGate, presses } = createHarness([
      dialog,
      hiddenOnce,
      hiddenTwice,
    ]);

    const result = await handler.advanceDialog();

    expect(result.status).toBe("success");
    expect(result.reason).toBe("dialog_ended");
    expect(inputGate.press).toHaveBeenCalledTimes(1);
    expect(presses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          button: "A",
          allowDialog: true,
          source: "auto",
        }),
      ])
    );
  });

  it("stops dialog advance on choices and naming screens", async () => {
    const dialog = mini({ mode: "dialog", screenText: "YES NO", windowY: 120 });
    const choice = createHarness([dialog], { choice: true });
    const naming = createHarness([dialog], { naming: true });

    await expect(choice.handler.advanceDialog()).resolves.toMatchObject({
      status: "interrupted",
      reason: "choice_appeared",
    });
    expect(choice.inputGate.press).not.toHaveBeenCalled();

    await expect(naming.handler.advanceDialog()).resolves.toMatchObject({
      status: "interrupted",
      reason: "naming_screen",
    });
    expect(naming.inputGate.press).not.toHaveBeenCalled();
  });

  it("reports dialog-to-battle transition as battle_started", async () => {
    const dialog = mini({ mode: "dialog", screenText: "Fight!", windowY: 120 });
    const battle = mini({ battle: 1, mode: "battle" });
    const { handler, inputGate } = createHarness([dialog, battle]);

    const result = await handler.advanceDialog();

    expect(result.status).toBe("success");
    expect(result.reason).toBe("battle_started");
    expect(inputGate.press).toHaveBeenCalledTimes(1);
  });

  it("reports dialog-to-naming transition as naming_screen", async () => {
    const dialog = mini({ mode: "dialog", screenText: "Name?", windowY: 120 });
    const naming = mini({
      mode: "naming",
      namingScreenType: 1,
      screenText: "lower case",
      windowY: WINDOW_HIDDEN_Y,
    });
    const { handler, inputGate } = createHarness([dialog, naming]);

    const result = await handler.advanceDialog();

    expect(result.status).toBe("interrupted");
    expect(result.reason).toBe("naming_screen");
    expect(inputGate.press).toHaveBeenCalledTimes(1);
  });

  it("advances battle end with bounded automatic A presses", async () => {
    const battle = mini({ battle: 1, mode: "battle" });
    const overworld = mini({ battle: 0, mode: "overworld" });
    const { handler, inputGate } = createHarness([battle, overworld], {
      enemyDefeated: true,
    });

    const result = await handler.advanceBattleEnd();

    expect(result.status).toBe("success");
    expect(result.reason).toBe("battle_ended");
    expect(inputGate.press).toHaveBeenCalledWith(
      "A",
      16,
      expect.objectContaining({ reason: "auto-battle-end", source: "auto" })
    );
  });

  it("does not advance an active battle when battle evidence says neither side ended", async () => {
    const battle = mini({ battle: 1, mode: "battle" });
    const harness = createHarness([battle]);
    const handler = new AutoHandler({
      dialogReader: {
        isChoiceActive: vi.fn(async () => false),
        isNamingScreenActive: vi.fn(async () => false),
      },
      inputGate: harness.inputGate,
      stateReader: { read: async () => battle },
      battleReader: {
        isEnemyDefeated: vi.fn(async () => false),
        isPartyWiped: vi.fn(async () => false),
      },
    });

    const result = await handler.advanceBattleEnd();

    expect(result.status).toBe("noop");
    expect(harness.inputGate.press).not.toHaveBeenCalled();
  });

  it("does not advance battle end without battle-end evidence", async () => {
    const battle = mini({ battle: 1, mode: "battle" });
    const inputGate = { press: vi.fn() };
    const handler = new AutoHandler({
      dialogReader: {
        isChoiceActive: vi.fn(async () => false),
        isNamingScreenActive: vi.fn(async () => false),
      },
      inputGate,
      stateReader: { read: async () => battle },
    });

    const result = await handler.advanceBattleEnd();

    expect(result.status).toBe("noop");
    expect(inputGate.press).not.toHaveBeenCalled();
  });

  it("handles post-battle dialog rounds after battle exit", async () => {
    const battle = mini({ battle: 1, mode: "battle" });
    const dialog = mini({
      battle: 0,
      mode: "dialog",
      screenText: "Won!",
      windowY: 120,
    });
    const hiddenOnce = mini({ mode: "overworld", windowY: WINDOW_HIDDEN_Y });
    const hiddenTwice = mini({ mode: "overworld", windowY: WINDOW_HIDDEN_Y });
    const { handler } = createHarness(
      [battle, dialog, hiddenOnce, hiddenTwice],
      { enemyDefeated: true }
    );

    const result = await handler.handlePostBattle();

    expect(result.reason).toBe("dialog_ended");
    expect(result.transcript).toContain("Won!");
  });

  it("handles post-warp script dialog then waits for joy-ignore lock to clear", async () => {
    const dialog = mini({
      mode: "dialog",
      screenText: "Arrived",
      windowY: 120,
    });
    const locked = mini({ joyIgnore: 0xff, mode: "overworld" });
    const settled = mini({ joyIgnore: 0, mode: "overworld" });
    const { handler, inputGate } = createHarness([dialog, locked, settled]);

    const result = await handler.handlePostWarp();

    expect(result.status).toBe("success");
    expect(result.reason).toBe("post_warp_settled");
    expect(result.transcript).toContain("Arrived");
    expect(inputGate.press).toHaveBeenCalledTimes(1);
  });

  it("preserves post-warp dialog-to-battle interrupts", async () => {
    const dialog = mini({
      mode: "dialog",
      screenText: "Wild appeared",
      windowY: 120,
    });
    const battle = mini({ battle: 1, mode: "battle" });
    const { handler } = createHarness([dialog, battle]);

    const result = await handler.handlePostWarp();

    expect(result.status).toBe("success");
    expect(result.reason).toBe("battle_started");
    expect(result.finalState.mode).toBe("battle");
  });
});
