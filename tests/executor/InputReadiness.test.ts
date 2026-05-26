import { describe, expect, it } from "vitest";
import { waitForInputReady } from "../../src/executor/InputReadiness.js";
import { RED_BLUE_MEMORY_MAP } from "../../src/pokemon/memoryMap.js";
import { RWY_ADDRESS } from "../../src/pokemon/GameWorld.js";

const map = RED_BLUE_MEMORY_MAP;

function createReader(sequence: Array<{ joyIgnore: number; walkCounter: number; windowY: number }>) {
  let callIndex = 0;

  function currentValues() {
    return sequence[Math.min(Math.floor(callIndex / 3), sequence.length - 1)];
  }

  return {
    read8(address: number): Promise<number> {
      const vals = currentValues();
      callIndex += 1;
      if (address === map.wJoyIgnore) {
        return Promise.resolve(vals.joyIgnore);
      }
      if (address === map.wWalkCounter) {
        return Promise.resolve(vals.walkCounter);
      }
      if (address === RWY_ADDRESS) {
        return Promise.resolve(vals.windowY);
      }
      return Promise.resolve(0);
    },
  };
}

const instantSleep = () => Promise.resolve();

describe("waitForInputReady", () => {
  it("returns ready immediately when all signals are clear", async () => {
    const reader = createReader([{ joyIgnore: 0, walkCounter: 0, windowY: 144 }]);

    const result = await waitForInputReady(reader, { sleep: instantSleep });

    expect(result.ready).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.joyIgnore).toBe(0);
    expect(result.walkCounter).toBe(0);
  });

  it("waits until joyIgnore clears", async () => {
    const reader = createReader([
      { joyIgnore: 0xff, walkCounter: 0, windowY: 144 },
      { joyIgnore: 0xff, walkCounter: 0, windowY: 144 },
      { joyIgnore: 0, walkCounter: 0, windowY: 144 },
      { joyIgnore: 0, walkCounter: 0, windowY: 144 },
    ]);

    const result = await waitForInputReady(reader, { sleep: instantSleep });

    expect(result.ready).toBe(true);
    expect(result.polls).toBeGreaterThanOrEqual(2);
  });

  it("waits until walkCounter clears", async () => {
    const reader = createReader([
      { joyIgnore: 0, walkCounter: 8, windowY: 144 },
      { joyIgnore: 0, walkCounter: 0, windowY: 144 },
      { joyIgnore: 0, walkCounter: 0, windowY: 144 },
    ]);

    const result = await waitForInputReady(reader, { sleep: instantSleep });

    expect(result.ready).toBe(true);
  });

  it("times out when signals never clear", async () => {
    const reader = createReader([
      { joyIgnore: 0xff, walkCounter: 0, windowY: 144 },
    ]);

    const result = await waitForInputReady(reader, {
      timeoutMs: 100,
      sleep: instantSleep,
    });

    expect(result.ready).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.joyIgnore).toBe(0xff);
  });

  it("allows dialog when allowDialog is true", async () => {
    const reader = createReader([
      { joyIgnore: 0, walkCounter: 0, windowY: 80 },
    ]);

    const result = await waitForInputReady(reader, {
      sleep: instantSleep,
      allowDialog: true,
    });

    expect(result.ready).toBe(true);
    expect(result.windowY).toBe(80);
  });

  it("blocks on dialog when allowDialog is false", async () => {
    const reader = createReader([
      { joyIgnore: 0, walkCounter: 0, windowY: 80 },
    ]);

    const result = await waitForInputReady(reader, {
      timeoutMs: 100,
      sleep: instantSleep,
      allowDialog: false,
    });

    expect(result.ready).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it("exempts joyIgnore during active dialog when allowDialog is true", async () => {
    const reader = createReader([
      { joyIgnore: 0xfc, walkCounter: 0, windowY: 0 },
    ]);

    const result = await waitForInputReady(reader, {
      sleep: instantSleep,
      allowDialog: true,
    });

    expect(result.ready).toBe(true);
    expect(result.joyIgnore).toBe(0xfc);
    expect(result.windowY).toBe(0);
  });

  it("blocks on joyIgnore when no dialog is active even with allowDialog", async () => {
    const reader = createReader([
      { joyIgnore: 0xfc, walkCounter: 0, windowY: 144 },
    ]);

    const result = await waitForInputReady(reader, {
      timeoutMs: 100,
      sleep: instantSleep,
      allowDialog: true,
    });

    expect(result.ready).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it("requires stable consecutive readings", async () => {
    const reader = createReader([
      { joyIgnore: 0, walkCounter: 0, windowY: 144 },
      { joyIgnore: 0xff, walkCounter: 0, windowY: 144 },
      { joyIgnore: 0, walkCounter: 0, windowY: 144 },
      { joyIgnore: 0, walkCounter: 0, windowY: 144 },
    ]);

    const result = await waitForInputReady(reader, { sleep: instantSleep });

    expect(result.ready).toBe(true);
    expect(result.polls).toBeGreaterThanOrEqual(2);
  });
});
