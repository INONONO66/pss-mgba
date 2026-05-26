import { describe, expect, it } from "vitest";
import { Controller, type ControllerClient } from "../../src/control/Controller.js";
import { HarnessError } from "../../src/shared/errors.js";
import type { MgbaButton } from "../../src/mgba/MgbaTypes.js";

type ClientCall =
  | { type: "tap"; button: MgbaButton; frames?: number }
  | { type: "hold"; button: MgbaButton; frames: number }
  | { type: "sleep"; ms: number };

function createFakeClient(calls: ClientCall[]): ControllerClient {
  return {
    async tapButton(button, frames) {
      calls.push({ type: "tap", button, frames });
    },
    async holdButton(button, frames) {
      calls.push({ type: "hold", button, frames });
    }
  };
}

describe("Controller", () => {
  it("executes sequence children in order", async () => {
    const calls: ClientCall[] = [];
    const controller = new Controller({
      client: createFakeClient(calls),
      frameDurationMs: 10,
      sleep: async (ms) => {
        calls.push({ type: "sleep", ms });
      }
    });

    await controller.execute({
      type: "sequence",
      actions: [
        { type: "press", button: "A", frames: 5 },
        { type: "wait", frames: 2 },
        { type: "hold", button: "Down", frames: 12 }
      ]
    });

    expect(calls).toEqual([
      { type: "hold", button: "A", frames: 5 },
      { type: "sleep", ms: 50 },
      { type: "sleep", ms: 20 },
      { type: "hold", button: "Down", frames: 12 },
      { type: "sleep", ms: 120 }
    ]);
  });

  it("rejects invalid button and frame payloads before client calls", async () => {
    const calls: ClientCall[] = [];
    const controller = new Controller({
      client: createFakeClient(calls),
      sleep: async (ms) => {
        calls.push({ type: "sleep", ms });
      }
    });

    await expect(
      controller.execute({
        type: "sequence",
        actions: [
          { type: "press", button: "L", frames: 5 },
          { type: "hold", button: "A", frames: 999 }
        ]
      })
    ).rejects.toMatchObject({ code: "ACTION_REJECTED" });

    expect(calls).toEqual([]);
  });

  it("stops a sequence and surfaces the child error when a client call fails", async () => {
    const calls: ClientCall[] = [];
    const failure = new HarnessError("MGBA_UNAVAILABLE", "hold failed", { context: { endpoint: "/hold" } });
    const controller = new Controller({
      client: {
        async tapButton(button, frames) {
          calls.push({ type: "tap", button, frames });
        },
        async holdButton(button, frames) {
          calls.push({ type: "hold", button, frames });
          throw failure;
        }
      },
      sleep: async (ms) => {
        calls.push({ type: "sleep", ms });
      }
    });

    await expect(
      controller.execute({
        type: "sequence",
        actions: [
          { type: "press", button: "A", frames: 1 },
          { type: "hold", button: "Down", frames: 3 }
        ]
      })
    ).rejects.toBe(failure);

    expect(calls).toEqual([{ type: "hold", button: "A", frames: 1 }]);
  });
});
