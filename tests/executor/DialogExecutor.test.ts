import { describe, expect, it, vi } from "vitest";
import type { DialogCommand } from "../../src/control/CommandTypes";
import { DialogExecutor, type DialogController, type DialogStateReader } from "../../src/executor/DialogExecutor";
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

function createStateReader(overrides: Partial<DialogStateReader> = {}): DialogStateReader {
  return {
    readTextBoxId: vi.fn(async () => 0),
    readCurrentMenuItem: vi.fn(async () => 0),
    readScreenText: vi.fn(async () => ""),
    isDialogActive: vi.fn(async () => false),
    isChoiceActive: vi.fn(async () => false),
    isNamingScreenActive: vi.fn(async () => false),
    ...overrides,
  };
}

function dialogCommand(action: DialogCommand["action"]): DialogCommand {
  return { type: "dialog", action };
}

describe("DialogExecutor", () => {
  it("advance ends dialog after 3 A presses", async () => {
    const { controller, presses } = createController();
    let aPresses = 0;
    const stateReader = createStateReader({
      readTextBoxId: vi.fn(async () => (aPresses >= 3 ? 0 : 1)),
      readScreenText: vi.fn(async () => (aPresses >= 3 ? "" : `text ${aPresses}`)),
      isDialogActive: vi.fn(async () => aPresses < 3),
    });
    vi.mocked(controller.pressButton).mockImplementation(async (button, frames) => {
      presses.push({ button, frames });
      if (button === "A") aPresses += 1;
    });

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "advance" }));

    expect(result).toEqual({ status: "success", reason: "dialog_ended" });
    expect(presses).toEqual([
      { button: "A", frames: 8 },
      { button: "A", frames: 8 },
      { button: "A", frames: 8 },
    ]);
  });

  it("advance stops when a choice appears after 2 A presses", async () => {
    const { controller, presses } = createController();
    let aPresses = 0;
    const stateReader = createStateReader({
      readTextBoxId: vi.fn(async () => 1),
      readScreenText: vi.fn(async () => (aPresses >= 2 ? "YES NO" : "Choose?")),
      isDialogActive: vi.fn(async () => true),
      isChoiceActive: vi.fn(async () => aPresses >= 2),
    });
    vi.mocked(controller.pressButton).mockImplementation(async (button, frames) => {
      presses.push({ button, frames });
      if (button === "A") aPresses += 1;
    });

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "advance" }));

    expect(result.status).toBe("success");
    expect(result.reason).toBe("choice_appeared");
    expect(result.details).toBe("choices=YES NO");
    expect(presses).toEqual([
      { button: "A", frames: 8 },
      { button: "A", frames: 8 },
    ]);
  });

  it("advance fails as stuck when text never changes for 30 A presses", async () => {
    const { controller, presses } = createController();
    const stateReader = createStateReader({
      readTextBoxId: vi.fn(async () => 1),
      readScreenText: vi.fn(async () => "same text"),
      isDialogActive: vi.fn(async () => true),
    });

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "advance" }));

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("dialog_stuck");
    expect(result.details).toBe("max_presses=30; text_changed=false");
    expect(presses).toHaveLength(30);
    expect(presses.every((press) => press.button === "A" && press.frames === 8)).toBe(true);
  });

  it("choose(1) from currentMenuItem 0 presses Down once, then A", async () => {
    const { controller, presses } = createController();
    const stateReader = createStateReader({
      readCurrentMenuItem: vi.fn(async () => 0),
    });

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "choose", index: 1 }));

    expect(result).toEqual({ status: "success", reason: "choice_made", details: "index=1" });
    expect(presses).toEqual([
      { button: "Down", frames: 8 },
      { button: "A", frames: 8 },
    ]);
  });

  it("choose(0) from currentMenuItem 2 presses Up twice, then A", async () => {
    const { controller, presses } = createController();
    const stateReader = createStateReader({
      readCurrentMenuItem: vi.fn(async () => 2),
    });

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "choose", index: 0 }));

    expect(result).toEqual({ status: "success", reason: "choice_made", details: "index=0" });
    expect(presses).toEqual([
      { button: "Up", frames: 8 },
      { button: "Up", frames: 8 },
      { button: "A", frames: 8 },
    ]);
  });

  it('input_name("RED") accepts the default character and confirms with Start', async () => {
    const { controller, presses } = createController();
    const stateReader = createStateReader();

    const executor = new DialogExecutor(controller, stateReader);
    const result = await executor.execute(dialogCommand({ kind: "input_name", name: "RED" }));

    expect(result).toEqual({ status: "success", reason: "name_entered", details: "name=RED" });
    expect(presses).toEqual([
      { button: "A", frames: 8 },
      { button: "Start", frames: 8 },
    ]);
  });
});
