import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MgbaButton } from "../../src/mgba/MgbaTypes.js";
import { executeNavigate } from "../../src/executor/NavigateExecutor.js";
import type { Position } from "../../src/executor/Pathfinder.js";

interface MockPosition extends Position {
  mapId?: number;
}

function allWalkable(width: number, height: number) {
  return {
    grid: Array.from({ length: height }, () => Array.from({ length: width }, () => true)),
    width,
    height,
  };
}

function parseGrid(ascii: string[]) {
  const grid = ascii.map((row) => [...row].map((cell) => cell === "."));
  return { grid, width: grid[0].length, height: grid.length };
}

function createMockController() {
  return {
    pressedButtons: [] as { button: MgbaButton; frames: number }[],
    async pressButton(button: MgbaButton, frames = 5) {
      this.pressedButtons.push({ button, frames });
    },
  };
}

function createMockWorldReader(
  positions: MockPosition[],
  opts?: { battleAt?: number; dialogAt?: number; mapChangeAt?: number },
) {
  let readCount = 0;
  let step = 0;

  return {
    async readPosition() {
      const position = positions[Math.min(readCount, positions.length - 1)];
      if (readCount > 0) step = Math.min(step + 1, positions.length - 1);
      readCount += 1;

      return {
        mapId: opts?.mapChangeAt === step ? 2 : (position.mapId ?? 1),
        y: position.y,
        x: position.x,
      };
    },
    async readWalkCounter() {
      return 0;
    },
    async isInBattle() {
      return opts?.battleAt === step;
    },
    async isDialogActive() {
      return opts?.dialogAt === step;
    },
  };
}

async function runNavigate(...args: Parameters<typeof executeNavigate>) {
  const result = executeNavigate(...args);

  for (let i = 0; i < 100; i += 1) {
    await vi.advanceTimersByTimeAsync(50);
  }

  return result;
}

describe("NavigateExecutor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1. simple path: (0,0) → (2,0) succeeds with Down, Down", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 0, y: 2 },
      controller,
      createMockWorldReader([{ y: 0, x: 0 }, { y: 1, x: 0 }, { y: 2, x: 0 }]),
      { walkabilityGrid: () => allWalkable(3, 3) },
    );

    expect(result).toEqual({ status: "success", reason: "arrived" });
    expect(controller.pressedButtons).toEqual([
      { button: "Down", frames: 5 },
      { button: "Down", frames: 5 },
    ]);
  });

  it("2. partial path: goal in unexplored area returns reached frontier", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 4, y: 0 },
      controller,
      createMockWorldReader([{ y: 0, x: 0 }, { y: 0, x: 1 }]),
      { walkabilityGrid: () => parseGrid(["..###", "..###", "..###"]) },
    );

    expect(result.status).toBe("partial");
    expect(result.reason).toBe("reached");
    expect(result.details).toBe("Reached (1,0), target in unexplored area");
  });

  it("3. no path: completely enclosed returns failed no_path", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 2, y: 2 },
      controller,
      createMockWorldReader([{ y: 1, x: 1 }]),
      { walkabilityGrid: () => parseGrid(["###", "#.#", "###"]) },
    );

    expect(result).toEqual({ status: "failed", reason: "no_path" });
    expect(controller.pressedButtons).toEqual([]);
  });

  it("4. battle interrupt: encounter at step 2 returns battle_started", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 0, y: 3 },
      controller,
      createMockWorldReader(
        [{ y: 0, x: 0 }, { y: 1, x: 0 }, { y: 2, x: 0 }, { y: 3, x: 0 }],
        { battleAt: 2 },
      ),
      { walkabilityGrid: () => allWalkable(4, 4) },
    );

    expect(result).toEqual({ status: "interrupted", reason: "battle_started" });
  });

  it("5. dialog interrupt: triggered at step 1 returns dialog_opened", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 0, y: 2 },
      controller,
      createMockWorldReader([{ y: 0, x: 0 }, { y: 1, x: 0 }, { y: 2, x: 0 }], { dialogAt: 1 }),
      { walkabilityGrid: () => allWalkable(3, 3) },
    );

    expect(result).toEqual({ status: "interrupted", reason: "dialog_opened" });
  });

  it("6. map change returns map_changed", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 0, y: 2 },
      controller,
      createMockWorldReader([{ y: 0, x: 0 }, { y: 1, x: 0 }, { y: 2, x: 0 }], { mapChangeAt: 1 }),
      { walkabilityGrid: () => allWalkable(3, 3) },
    );

    expect(result).toEqual({ status: "interrupted", reason: "map_changed" });
  });

  it("7. already at target succeeds immediately", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 3, y: 3 },
      controller,
      createMockWorldReader([{ y: 3, x: 3 }]),
      { walkabilityGrid: () => allWalkable(5, 5) },
    );

    expect(result).toEqual({ status: "success", reason: "arrived" });
    expect(controller.pressedButtons).toEqual([]);
  });

  it("8. NPC blocking: unchanged position retries then fails", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 0, y: 1 },
      controller,
      createMockWorldReader([{ y: 0, x: 0 }]),
      { walkabilityGrid: () => allWalkable(2, 2) },
    );

    expect(result).toEqual({ status: "failed", reason: "blocked_by_npc" });
    expect(controller.pressedButtons).toEqual([
      { button: "Down", frames: 5 },
      { button: "Down", frames: 30 },
      { button: "Down", frames: 5 },
      { button: "Down", frames: 30 },
      { button: "Down", frames: 5 },
      { button: "Down", frames: 30 },
    ]);
  });

  it("9. bottom-edge warp: walks to warp tile and pushes down", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 3, y: 7 },
      controller,
      createMockWorldReader([
        { y: 5, x: 5 },
        { y: 6, x: 5 },
        { y: 6, x: 4 },
        { y: 6, x: 3 },
        { y: 7, x: 3 },
        { y: 8, x: 3, mapId: 2 },
      ]),
      {
        walkabilityGrid: () => parseGrid([
          "########",
          "########",
          "########",
          "########",
          "#####.##",
          "#####.##",
          "###...##",
          "###.####",
        ]),
        warpPositions: () => [{ y: 7, x: 3 }],
      },
    );

    expect(result).toEqual({ status: "success", reason: "warped" });
    expect(controller.pressedButtons).toEqual([
      { button: "Down", frames: 5 },
      { button: "Left", frames: 5 },
      { button: "Left", frames: 5 },
      { button: "Down", frames: 5 },
      { button: "Down", frames: 5 },
    ]);
  });

  it("10a. south edge map transition: stepping onto bottom edge triggers map_transition", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 2, y: 3 },
      controller,
      createMockWorldReader([
        { y: 1, x: 2 },
        { y: 2, x: 2 },
        { y: 3, x: 2, mapId: 2 },
      ], { mapChangeAt: 2 }),
      { walkabilityGrid: () => allWalkable(4, 4) },
    );

    expect(result).toEqual({ status: "success", reason: "map_transition" });
  });

  it("10b. north edge map transition: stepping onto top edge triggers map_transition", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 2, y: 0 },
      controller,
      createMockWorldReader([
        { y: 2, x: 2 },
        { y: 1, x: 2 },
        { y: 0, x: 2, mapId: 2 },
      ], { mapChangeAt: 2 }),
      { walkabilityGrid: () => allWalkable(4, 4) },
    );

    expect(result).toEqual({ status: "success", reason: "map_transition" });
  });

  it("10c. mid-map change away from edges still returns interrupted", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 2, y: 6 },
      controller,
      createMockWorldReader([
        { y: 2, x: 2 },
        { y: 3, x: 2 },
        { y: 4, x: 2 },
      ], { mapChangeAt: 1 }),
      { walkabilityGrid: () => allWalkable(5, 8) },
    );

    expect(result).toEqual({ status: "interrupted", reason: "map_changed" });
  });

  it("11. fixed obstacle: routes around blocked tile", async () => {
    const controller = createMockController();
    const result = await runNavigate(
      { type: "navigate", x: 3, y: 2 },
      controller,
      createMockWorldReader([
        { y: 2, x: 0 },
        { y: 3, x: 0 },
        { y: 3, x: 1 },
        { y: 3, x: 2 },
        { y: 3, x: 3 },
        { y: 2, x: 3 },
      ]),
      { walkabilityGrid: () => parseGrid(["....", "####", ".#..", "...."]) },
    );

    expect(result).toEqual({ status: "success", reason: "arrived" });
    expect(controller.pressedButtons).toEqual([
      { button: "Down", frames: 5 },
      { button: "Right", frames: 5 },
      { button: "Right", frames: 5 },
      { button: "Right", frames: 5 },
      { button: "Up", frames: 5 },
    ]);
  });
});
