import { describe, it, expect } from "vitest";
import { findPath } from "../../src/executor/Pathfinder";

function parseGrid(ascii: string[]): { grid: boolean[][]; width: number; height: number } {
  const grid = ascii.map((row) => [...row].map((c) => c === "."));
  return { grid, width: grid[0].length, height: grid.length };
}

describe("Pathfinder", () => {
  it("1. Open field: 5×5 all walkable, (0,0) → (4,4) → found, path length = 8", () => {
    const { grid, width, height } = parseGrid([
      ".....",
      ".....",
      ".....",
      ".....",
      ".....",
    ]);
    const result = findPath(grid, { y: 0, x: 0 }, { y: 4, x: 4 }, width, height);
    expect(result.status).toBe("found");
    expect(result.path.length).toBe(8); // Manhattan distance = 4+4 = 8
    expect(result.reachedPosition).toEqual({ y: 4, x: 4 });
    // Verify path ends at goal
    expect(result.path[result.path.length - 1]).toEqual({ y: 4, x: 4 });
    // Verify path is contiguous (each step is adjacent)
    let prev = { y: 0, x: 0 };
    for (const pos of result.path) {
      const dist = Math.abs(pos.y - prev.y) + Math.abs(pos.x - prev.x);
      expect(dist).toBe(1);
      prev = pos;
    }
  });

  it("2. Wall avoidance: 5×5 with wall at row 2 (except col 0), (0,2) → (4,2) → found", () => {
    // Wall blocks row 2 from x=1 to x=4, open at x=0
    const { grid, width, height } = parseGrid([
      ".....",
      ".....",
      ".####",
      ".....",
      ".....",
    ]);
    const result = findPath(grid, { y: 0, x: 2 }, { y: 4, x: 2 }, width, height);
    expect(result.status).toBe("found");
    expect(result.reachedPosition).toEqual({ y: 4, x: 2 });
    // Path must go around the wall
    // Verify no step lands on a wall
    for (const pos of result.path) {
      expect(grid[pos.y][pos.x]).toBe(true);
    }
    // Verify path is contiguous
    let prev = { y: 0, x: 2 };
    for (const pos of result.path) {
      const dist = Math.abs(pos.y - prev.y) + Math.abs(pos.x - prev.x);
      expect(dist).toBe(1);
      prev = pos;
    }
  });

  it("3. Partial path: 5×5 with right half all false, (0,0) → (4,4) → partial", () => {
    const { grid, width, height } = parseGrid([
      "..###",
      "..###",
      "..###",
      "..###",
      "..###",
    ]);
    const result = findPath(grid, { y: 0, x: 0 }, { y: 4, x: 4 }, width, height);
    expect(result.status).toBe("partial");
    // Should reach the edge of the walkable area (x=1 is the rightmost walkable column)
    expect(result.reachedPosition.x).toBeLessThanOrEqual(1);
    // Path should be non-empty (we moved somewhere)
    expect(result.path.length).toBeGreaterThan(0);
  });

  it("4. No path: start surrounded by walls → no_path", () => {
    const { grid, width, height } = parseGrid([
      "#####",
      "#.###",
      "#####",
      "#####",
      "#####",
    ]);
    // Start at (1,1) which is walkable but surrounded by walls
    const result = findPath(grid, { y: 1, x: 1 }, { y: 4, x: 4 }, width, height);
    expect(result.status).toBe("no_path");
    expect(result.path).toEqual([]);
    expect(result.reachedPosition).toEqual({ y: 1, x: 1 });
  });

  it("5. Already there: start === goal → found, empty path", () => {
    const { grid, width, height } = parseGrid([
      ".....",
      ".....",
      ".....",
    ]);
    const result = findPath(grid, { y: 1, x: 2 }, { y: 1, x: 2 }, width, height);
    expect(result.status).toBe("found");
    expect(result.path).toEqual([]);
    expect(result.reachedPosition).toEqual({ y: 1, x: 2 });
  });

  it("6. Corridor: 1-wide passage → navigates through", () => {
    const { grid, width, height } = parseGrid([
      "#####",
      ".....",
      "#####",
    ]);
    const result = findPath(grid, { y: 1, x: 0 }, { y: 1, x: 4 }, width, height);
    expect(result.status).toBe("found");
    expect(result.reachedPosition).toEqual({ y: 1, x: 4 });
    expect(result.path.length).toBe(4);
    // All steps must stay in the corridor (row 1)
    for (const pos of result.path) {
      expect(pos.y).toBe(1);
    }
  });

  it("7. Goal out of bounds → no_path", () => {
    const { grid, width, height } = parseGrid([
      ".....",
      ".....",
    ]);
    const result = findPath(grid, { y: 0, x: 0 }, { y: 5, x: 5 }, width, height);
    expect(result.status).toBe("no_path");
    expect(result.path).toEqual([]);
  });

  it("8. Performance: 20×18 grid (max Gen1 map), completes in < 10ms", () => {
    // All walkable 20×18 grid
    const grid: boolean[][] = Array.from({ length: 18 }, () =>
      Array.from({ length: 20 }, () => true),
    );
    const width = 20;
    const height = 18;

    const start = performance.now();
    const result = findPath(grid, { y: 0, x: 0 }, { y: 17, x: 19 }, width, height);
    const elapsed = performance.now() - start;

    expect(result.status).toBe("found");
    expect(elapsed).toBeLessThan(10);
  });

  it("L-shaped obstacle: path goes around corner", () => {
    const { grid, width, height } = parseGrid([
      "......",
      "###...",
      "...#..",
      "...#..",
      "......",
    ]);
    // Start top-left, goal bottom-right
    const result = findPath(grid, { y: 0, x: 0 }, { y: 4, x: 5 }, width, height);
    expect(result.status).toBe("found");
    expect(result.reachedPosition).toEqual({ y: 4, x: 5 });
    for (const pos of result.path) {
      expect(grid[pos.y][pos.x]).toBe(true);
    }
  });

  it("Goal not walkable (wall): returns partial or no_path", () => {
    const { grid, width, height } = parseGrid([
      ".....",
      ".....",
      "....#",
    ]);
    // Goal is a wall at (2,4)
    const result = findPath(grid, { y: 0, x: 0 }, { y: 2, x: 4 }, width, height);
    // Goal is a wall — A* can't reach it, should return partial (closest reachable)
    expect(["partial", "no_path"]).toContain(result.status);
    if (result.status === "partial") {
      expect(grid[result.reachedPosition.y][result.reachedPosition.x]).toBe(true);
    }
  });

  it("Start not walkable → no_path", () => {
    const { grid, width, height } = parseGrid([
      "#....",
      ".....",
    ]);
    const result = findPath(grid, { y: 0, x: 0 }, { y: 1, x: 4 }, width, height);
    expect(result.status).toBe("no_path");
  });
});
