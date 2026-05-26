import { describe, expect, it } from "vitest";
import { executeInteract } from "../../src/executor/InteractExecutor.js";

function createController() {
  const pressed: { button: string; frames: number }[] = [];
  return {
    pressed,
    pressButton(button: string, frames = 5): Promise<void> {
      pressed.push({ button, frames });
      return Promise.resolve();
    },
  };
}

function createStateReader(
  initialFacing: string,
  dialogActive: boolean,
  facingSequence?: string[],
) {
  let callIndex = 0;
  const sequence = facingSequence ?? [initialFacing];
  return {
    readFacingDirection(): Promise<string> {
      const facing = sequence[Math.min(callIndex, sequence.length - 1)];
      callIndex += 1;
      return Promise.resolve(facing);
    },
    isDialogActive(): Promise<boolean> {
      return Promise.resolve(dialogActive);
    },
  };
}

describe("InteractExecutor", () => {
  it("no direction → just A pressed", async () => {
    const ctrl = createController();

    const result = await executeInteract(
      { type: "interact" },
      ctrl,
      createStateReader("down", false),
    );

    expect(ctrl.pressed).toEqual([{ button: "A", frames: 8 }]);
    expect(result.reason).toBe("interacted");
  });

  it("already facing requested direction → skip turn, just A", async () => {
    const ctrl = createController();

    await executeInteract(
      { type: "interact", direction: "right" },
      ctrl,
      createStateReader("right", false, ["right"]),
    );

    expect(ctrl.pressed).toEqual([{ button: "A", frames: 8 }]);
  });

  it("direction change succeeds on first attempt", async () => {
    const ctrl = createController();

    await executeInteract(
      { type: "interact", direction: "up" },
      ctrl,
      createStateReader("down", false, ["down", "up"]),
    );

    expect(ctrl.pressed).toEqual([
      { button: "Up", frames: 8 },
      { button: "A", frames: 8 },
    ]);
  });

  it("direction change succeeds on second retry with increased frames", async () => {
    const ctrl = createController();

    await executeInteract(
      { type: "interact", direction: "left" },
      ctrl,
      createStateReader("up", false, ["up", "up", "left"]),
    );

    expect(ctrl.pressed).toEqual([
      { button: "Left", frames: 8 },
      { button: "Left", frames: 16 },
      { button: "A", frames: 8 },
    ]);
  });

  it("direction change fails after max retries → direction_change_failed", async () => {
    const ctrl = createController();

    const result = await executeInteract(
      { type: "interact", direction: "left" },
      ctrl,
      createStateReader("up", false, ["up", "up", "up", "up"]),
    );

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("direction_change_failed");
    expect(ctrl.pressed).toEqual([
      { button: "Left", frames: 8 },
      { button: "Left", frames: 16 },
      { button: "Left", frames: 24 },
    ]);
  });

  it("dialog triggered → reason dialog_started", async () => {
    const ctrl = createController();

    const result = await executeInteract(
      { type: "interact" },
      ctrl,
      createStateReader("up", true),
    );

    expect(result.reason).toBe("dialog_started");
    expect(result.details).toBe("Interaction triggered dialog");
  });

  it("no dialog → reason interacted", async () => {
    const ctrl = createController();

    const result = await executeInteract(
      { type: "interact" },
      ctrl,
      createStateReader("up", false),
    );

    expect(result.reason).toBe("interacted");
    expect(result.details).toBe("Pressed A");
  });
});
