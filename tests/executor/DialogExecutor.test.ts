import { describe, expect, it, vi } from "vitest";
import type { DialogCommand } from "../../src/control/CommandTypes";
import {
  DialogExecutor,
  type DialogController,
  type DialogStateReader,
} from "../../src/executor/DialogExecutor";
import type { MgbaButton } from "../../src/mgba/MgbaTypes";

function createController() {
  const presses: Array<{ button: MgbaButton; frames?: number }> = [];
  const controller: DialogController = {
    pressButton: vi.fn(async (button: MgbaButton, frames?: number) => {
      presses.push({ button, frames });
    }),
  };

  return { controller, presses };
}

function createStateReader(
  overrides: Partial<DialogStateReader> = {}
): DialogStateReader {
  return {
    readTextBoxId: vi.fn(async () => 0),
    readCurrentMenuItem: vi.fn(async () => 0),
    readScreenText: vi.fn(async () => ""),
    readTileAt: vi.fn(async () => 0),
    isDialogActive: vi.fn(async () => false),
    isWindowVisible: vi.fn(async () => false),
    isInBattle: vi.fn(async () => false),
    isChoiceActive: vi.fn(async () => false),
    isNamingScreenActive: vi.fn(async () => false),
    ...overrides,
  };
}

function dialogCommand(action: DialogCommand["action"]): DialogCommand {
  return { type: "dialog", action };
}

function trackAPresses(
  controller: DialogController,
  presses: Array<{ button: MgbaButton; frames?: number }>,
  counter: { value: number }
): void {
  vi.mocked(controller.pressButton).mockImplementation(
    async (button: MgbaButton, frames?: number) => {
      presses.push({ button, frames });
      if (button === "A") {
        counter.value += 1;
      }
    }
  );
}

describe("DialogExecutor", () => {
  it("advance returns dialog_ended when window is not visible", async () => {
    const { controller, presses } = createController();
    const stateReader = createStateReader();

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "advance" }));

    expect(result.status).toBe("success");
    expect(result.reason).toBe("dialog_ended");
    expect(presses).toHaveLength(1);
  });

  it("advance collects transcript and ends when window hides", async () => {
    const { controller, presses } = createController();
    const counter = { value: 0 };
    const stateReader = createStateReader({
      readScreenText: vi.fn(async () => {
        if (counter.value <= 1) {
          return "Hello there!";
        }
        if (counter.value <= 3) {
          return "Welcome!";
        }
        return "";
      }),
      isWindowVisible: vi.fn(async () => counter.value < 4),
    });
    trackAPresses(controller, presses, counter);

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "advance" }));

    expect(result.status).toBe("success");
    expect(result.reason).toBe("dialog_ended");
    const details = result.details ?? "";
    expect(details).toContain("Hello there!");
    expect(details).toContain("Welcome!");
  });

  it("advance does not record duplicate pages", async () => {
    const { controller, presses } = createController();
    const counter = { value: 0 };
    const stateReader = createStateReader({
      readScreenText: vi.fn(async () => {
        if (counter.value < 3) {
          return "Same text";
        }
        return "";
      }),
      isWindowVisible: vi.fn(async () => counter.value < 3),
    });
    trackAPresses(controller, presses, counter);

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "advance" }));

    expect(result.status).toBe("success");
    expect(result.reason).toBe("dialog_ended");
    const transcript = JSON.parse(
      (result.details ?? "").replace("transcript=", "")
    );
    expect(transcript).toEqual(["Same text"]);
  });

  // Regression for docs/debugging/018: dialog-end false positive during a
  // page transition where rWY momentarily reads >= 144 but the tilemap still
  // holds the previous page's text. Reproduces the failure class documented
  // in docs/debugging/013-dialog-mode-mismatch-after-battle.md.
  //
  // Sequence (counter increments per A press):
  //   0-1: window visible, screenText="page 1 text"     → record page 1
  //   2-3: window HIDDEN, screenText="page 1 text"      ← flicker (text retained)
  //   4-5: window visible, screenText="page 2 text"     → record page 2
  //   6+:  window HIDDEN, screenText=""                 → true end (CloseTextDisplay)
  //
  // CURRENT BUG: streak hits 2 at counter=3 with non-empty text on tilemap →
  //              returns dialog_ended prematurely with transcript=["page 1 text"].
  // FIX EXPECTATION: while text is non-empty, hidden reads do NOT advance the
  //                  streak; executor presses past the flicker and ends only when
  //                  rWY hidden AND tilemap cleared.
  it("advance keeps pressing A on mid-page flicker when tilemap still shows dialog text", async () => {
    const { controller, presses } = createController();
    const counter = { value: 0 };
    const stateReader = createStateReader({
      readScreenText: vi.fn(async () => {
        const c = counter.value;
        if (c < 4) {
          return "page 1 text";
        }
        if (c < 6) {
          return "page 2 text";
        }
        return "";
      }),
      isWindowVisible: vi.fn(async () => {
        const c = counter.value;
        if (c === 2 || c === 3) {
          return false;
        }
        if (c >= 6) {
          return false;
        }
        return true;
      }),
    });
    trackAPresses(controller, presses, counter);

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "advance" }));

    expect(result.status).toBe("success");
    expect(result.reason).toBe("dialog_ended");

    const details = result.details ?? "";
    expect(details).toContain("page 1 text");
    // BUG GUARD: page 2 is never recorded if executor exits at the flicker.
    expect(details).toContain("page 2 text");
    // BUG GUARD: under current code presses === 3 (stops at counter=3); the fix
    // must press through the flicker and at least past read 4 (page 2).
    expect(presses.length).toBeGreaterThan(4);
  });

  it("advance stops when a choice appears", async () => {
    const { controller, presses } = createController();
    const counter = { value: 0 };
    const stateReader = createStateReader({
      readScreenText: vi.fn(async () => {
        if (counter.value >= 2) {
          return "YES NO Do you want?";
        }
        return "Some dialog";
      }),
      isWindowVisible: vi.fn(async () => true),
      isChoiceActive: vi.fn(async () => counter.value >= 2),
    });
    trackAPresses(controller, presses, counter);

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "advance" }));

    expect(result.status).toBe("success");
    expect(result.reason).toBe("choice_appeared");
    const details = result.details ?? "";
    expect(details).toContain("YES NO Do you want?");
  });

  it("advance stops when battle starts", async () => {
    const { controller, presses } = createController();
    const counter = { value: 0 };
    const stateReader = createStateReader({
      readScreenText: vi.fn(async () => "Trainer wants to fight!"),
      isWindowVisible: vi.fn(async () => true),
      isInBattle: vi.fn(async () => counter.value >= 2),
    });
    trackAPresses(controller, presses, counter);

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "advance" }));

    expect(result.status).toBe("success");
    expect(result.reason).toBe("battle_started");
  });

  it("advance fails as stuck when window stays visible for 120 presses", async () => {
    const { controller, presses } = createController();
    const stateReader = createStateReader({
      readScreenText: vi.fn(async () => "same text"),
      isWindowVisible: vi.fn(async () => true),
    });

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "advance" }));

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("dialog_stuck");
    expect(presses).toHaveLength(120);
  });

  it("choose(1) from currentMenuItem 0 presses Down once, then A", async () => {
    const { controller, presses } = createController();
    const stateReader = createStateReader({
      readCurrentMenuItem: vi.fn(async () => 0),
    });

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(
      dialogCommand({ kind: "choose", index: 1 })
    );

    expect(result).toMatchObject({ status: "success", reason: "choice_made" });
    expect(presses[0]).toEqual({ button: "Down", frames: 16 });
    expect(presses[1]).toEqual({ button: "A", frames: 16 });
  });

  it("choose(0) from currentMenuItem 2 presses Up twice, then A", async () => {
    const { controller, presses } = createController();
    const stateReader = createStateReader({
      readCurrentMenuItem: vi.fn(async () => 2),
    });

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(
      dialogCommand({ kind: "choose", index: 0 })
    );

    expect(result).toMatchObject({ status: "success", reason: "choice_made" });
    expect(presses[0]).toEqual({ button: "Up", frames: 16 });
    expect(presses[1]).toEqual({ button: "Up", frames: 16 });
    expect(presses[2]).toEqual({ button: "A", frames: 16 });
  });

  it('input_name("RED") presses A then Start', async () => {
    const { controller, presses } = createController();
    const stateReader = createStateReader();

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(
      dialogCommand({ kind: "input_name", name: "RED" })
    );

    expect(result).toEqual({
      status: "success",
      reason: "name_entered",
      details: "name=RED",
    });
    expect(presses).toEqual([
      { button: "A", frames: 16 },
      { button: "Start", frames: 16 },
    ]);
  });
});
