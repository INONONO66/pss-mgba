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

  // Regression mirror of DialogExecutor S2 (see docs/debugging/018):
  // the mode classifier flips to overworld when rWY transiently bounces to
  // 144 during a page transition, but the tilemap still shows the previous
  // page's text. The auto-handler must not call this "dialog_ended" and lose
  // subsequent pages.
  //
  // States (consumed by independent readIndex and pressIndex; see createHarness):
  //   [0] dialog,    windowY=120, screenText="page 1"   ← initial read; recorded
  //   [1] overworld, windowY=144, screenText="page 1"   ← flicker (tilemap retains)
  //   [2] overworld, windowY=144, screenText="page 1"   ← flicker continues
  //   [3] dialog,    windowY=120, screenText="page 2"   ← next page appears
  //   [4] overworld, windowY=144, screenText=""         ← true end starts
  //   [5] overworld, windowY=144, screenText=""         ← true end confirmed
  //
  // CURRENT BUG: hiddenReads hits 2 at state [2] → returns dialog_ended with
  //              transcript=["page 1"] only and inputGate.press called once.
  // FIX EXPECTATION: hidden reads with non-empty screenText do NOT increment
  //                  hiddenReads; auto-handler reads through the flicker and
  //                  records page 2 before the true (empty) end fires.
  // Oracle reviewer required regression (docs/debugging/018 Open Risk #2):
  // Without a poll cap, the mid-flicker branch (sleep+read+continue) could
  // spin forever if RAM gets stuck reporting window-hidden + non-empty
  // tilemap text. The cap returns blocked/dialog_stuck after
  // dialogFlickerPolls reads instead of hanging.
  it("returns blocked/dialog_stuck when state stays hidden with non-empty tilemap forever", async () => {
    const dialog = mini({
      mode: "dialog",
      screenText: "page 1",
      windowY: 120,
    });
    const stuckFlicker = mini({
      mode: "overworld",
      screenText: "still showing page 1",
      windowY: WINDOW_HIDDEN_Y,
    });
    let readIndex = 0;
    let pressIndex = 0;
    const states = [dialog, stuckFlicker];
    const inputGate = {
      press: vi.fn((button, frames, intentOptions) => {
        const before = states[Math.min(pressIndex, states.length - 1)];
        pressIndex += 1;
        const after = states[Math.min(pressIndex, states.length - 1)];
        const intent = {
          button,
          frames,
          allowDialog: intentOptions?.allowDialog,
          reason: intentOptions?.reason,
          source: intentOptions?.source ?? "auto",
        } satisfies InputIntent;
        return Promise.resolve(inputResult(before, after, intent));
      }),
    };
    const handler = new AutoHandler({
      dialogReader: {
        isChoiceActive: vi.fn(async () => false),
        isNamingScreenActive: vi.fn(async () => false),
      },
      inputGate,
      stateReader: {
        read(): Promise<MiniState> {
          const state = states[Math.min(readIndex, states.length - 1)];
          readIndex += 1;
          return Promise.resolve(state);
        },
      },
      options: {
        dialogFlickerPolls: 3,
        dialogHiddenConfirmCount: 2,
        dialogPresses: 50,
        lockPollIntervalMs: 0,
        sleep: async () => undefined,
      },
    });

    const result = await handler.advanceDialog();

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("dialog_stuck");
    expect(inputGate.press).toHaveBeenCalledTimes(1);
  });

  it("advances dialog through mid-page flicker when tilemap retains text", async () => {
    const dialog1 = mini({
      mode: "dialog",
      screenText: "page 1",
      windowY: 120,
    });
    const flicker1 = mini({
      mode: "overworld",
      screenText: "page 1",
      windowY: WINDOW_HIDDEN_Y,
    });
    const flicker2 = mini({
      mode: "overworld",
      screenText: "page 1",
      windowY: WINDOW_HIDDEN_Y,
    });
    const dialog2 = mini({
      mode: "dialog",
      screenText: "page 2",
      windowY: 120,
    });
    const trueEnd1 = mini({
      mode: "overworld",
      screenText: "",
      windowY: WINDOW_HIDDEN_Y,
    });
    const trueEnd2 = mini({
      mode: "overworld",
      screenText: "",
      windowY: WINDOW_HIDDEN_Y,
    });
    const { handler, inputGate } = createHarness([
      dialog1,
      flicker1,
      flicker2,
      dialog2,
      trueEnd1,
      trueEnd2,
    ]);

    const result = await handler.advanceDialog();

    expect(result.status).toBe("success");
    expect(result.reason).toBe("dialog_ended");
    expect(result.transcript).toContain("page 1");
    // BUG GUARD: page 2 is missing if executor exits at flicker before [3].
    expect(result.transcript).toContain("page 2");
    // BUG GUARD: under current code press is called once; fix must press twice
    // (once for page 1 → flicker, once for page 2 → true end).
    expect(inputGate.press).toHaveBeenCalledTimes(2);
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
