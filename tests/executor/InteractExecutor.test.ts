import { describe, expect, it } from "vitest";
import { executeInteract } from "../../src/executor/InteractExecutor.js";

const mockController = {
  pressedButtons: [] as { button: string; frames: number }[],
  async pressButton(button: string, frames = 5) {
    this.pressedButtons.push({ button, frames });
  },
};

function createStateReader(facing: string, dialogActive: boolean) {
  return {
    async readFacingDirection() {
      return facing;
    },
    async isDialogActive() {
      return dialogActive;
    },
  };
}

describe("InteractExecutor", () => {
  it("1. no direction, no facing change needed → just A pressed", async () => {
    mockController.pressedButtons = [];

    const result = await executeInteract(
      { type: "interact" },
      mockController,
      createStateReader("down", false),
    );

    expect(mockController.pressedButtons).toEqual([{ button: "A", frames: 5 }]);
    expect(result.reason).toBe("interacted");
  });

  it("2. direction up while facing down → presses Up then A", async () => {
    mockController.pressedButtons = [];

    await executeInteract(
      { type: "interact", direction: "up" },
      mockController,
      createStateReader("down", false),
    );

    expect(mockController.pressedButtons).toEqual([
      { button: "Up", frames: 5 },
      { button: "A", frames: 5 },
    ]);
  });

  it("3. direction right while already facing right → just A", async () => {
    mockController.pressedButtons = [];

    await executeInteract(
      { type: "interact", direction: "right" },
      mockController,
      createStateReader("right", false),
    );

    expect(mockController.pressedButtons).toEqual([{ button: "A", frames: 5 }]);
  });

  it("4. dialog triggered → reason dialog_started", async () => {
    mockController.pressedButtons = [];

    const result = await executeInteract(
      { type: "interact" },
      mockController,
      createStateReader("up", true),
    );

    expect(result.reason).toBe("dialog_started");
    expect(result.details).toBe("Interaction triggered dialog");
  });

  it("5. no dialog → reason interacted", async () => {
    mockController.pressedButtons = [];

    const result = await executeInteract(
      { type: "interact" },
      mockController,
      createStateReader("up", false),
    );

    expect(result.reason).toBe("interacted");
    expect(result.details).toBe("Pressed A");
  });
});
