import { describe, expect, it, vi } from "vitest";
import { createMiniState } from "../../src/session/mini-state-reader.js";
import type { InputResult } from "../../src/session/types.js";
import { runSupervisorIntervention } from "../../src/supervisor/intervention-loop.js";

function result(
  button: InputResult["intent"]["button"],
  frames: number,
  executed = true
): InputResult {
  const state = createMiniState({
    battle: 0,
    textBoxId: 0,
    letterDelay: 0,
    mapId: 1,
    y: 2,
    x: 3,
    partyCount: 1,
    walkCounter: 0,
    joyIgnore: 0,
    namingScreenType: 0,
    windowY: 144,
    screenText: "",
  });
  return {
    after: state,
    before: state,
    executed,
    reason: executed ? undefined : "text-window",
    intent: { button, frames, source: "supervisor" },
    transition: { after: state, before: state, kind: "none" },
  };
}

describe("Supervisor InterventionLoop", () => {
  it("routes vision intervention inputs through InputGate as supervisor input", async () => {
    const inputGate = {
      press: vi.fn(async (button, frames) => result(button, frames)),
    };

    const output = await runSupervisorIntervention({
      inputGate,
      inputs: [{ button: "A", frames: 8 }],
      reason: "vision-intervention",
    });

    expect(output.result).toMatchObject({
      status: "success",
      reason: "recovery_input",
    });
    expect(inputGate.press).toHaveBeenCalledWith(
      "A",
      8,
      expect.objectContaining({
        allowDialog: true,
        reason: "recovery:vision-intervention",
        source: "supervisor",
      })
    );
  });

  it("does not bypass text-window protection for directional recovery input", async () => {
    const inputGate = {
      press: vi.fn(async (button, frames) => result(button, frames, false)),
    };

    const output = await runSupervisorIntervention({
      inputGate,
      inputs: [
        { button: "Up", frames: 8 },
        { button: "A", frames: 8 },
      ],
      reason: "vision-intervention",
    });

    expect(output.result).toMatchObject({
      status: "rejected",
      reason: "text-window",
    });
    expect(output.commandInputs).toEqual([{ button: "Up", frames: 8 }]);
    expect(inputGate.press).toHaveBeenCalledTimes(1);
    expect(inputGate.press).toHaveBeenCalledWith(
      "Up",
      8,
      expect.objectContaining({
        allowDialog: false,
        source: "supervisor",
      })
    );
  });

  it("rejects invalid intervention shape before input", async () => {
    const inputGate = { press: vi.fn() };

    const output = await runSupervisorIntervention({
      inputGate,
      inputs: [{ button: "A", frames: 61 }],
      reason: "bad",
    });

    expect(output.result).toMatchObject({
      status: "rejected",
      reason: "invalid_intervention",
    });
    expect(inputGate.press).not.toHaveBeenCalled();
  });

  it("stops on the first rejected InputGate result", async () => {
    const inputGate = {
      press: vi
        .fn()
        .mockResolvedValueOnce(result("A", 8, false))
        .mockResolvedValueOnce(result("B", 8)),
    };

    const output = await runSupervisorIntervention({
      inputGate,
      inputs: [
        { button: "A", frames: 8 },
        { button: "B", frames: 8 },
      ],
      reason: "vision-intervention",
    });

    expect(output.result).toMatchObject({
      status: "rejected",
      reason: "text-window",
    });
    expect(output.commandInputs).toEqual([{ button: "A", frames: 8 }]);
    expect(inputGate.press).toHaveBeenCalledTimes(1);
  });
});
