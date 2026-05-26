import { describe, expect, it, beforeEach } from "vitest";
import { MapGraph } from "../../src/game/MapGraph.js";
import type { MapGraphInput } from "../../src/game/MapGraph.js";

// Small test world:
// Pallet Town (map 0): warp(5,3)→map 40 (Oak's Lab), connection north→map 12 (Route 1)
// Route 1 (map 12): connection south→map 0, connection north→map 1
// Oak's Lab (map 40): warp(4,11)→map 0
// Viridian City (map 1): connection south→map 12

const PALLET_TOWN = 0;
const VIRIDIAN_CITY = 1;
const ROUTE_1 = 12;
const OAKS_LAB = 40;

const TEST_MAPS: MapGraphInput[] = [
  {
    mapId: PALLET_TOWN,
    warps: [{ y: 5, x: 3, destMapId: OAKS_LAB, destWarpId: 0 }],
    connections: { north: ROUTE_1 },
  },
  {
    mapId: ROUTE_1,
    warps: [],
    connections: { south: PALLET_TOWN, north: VIRIDIAN_CITY },
  },
  {
    mapId: OAKS_LAB,
    warps: [{ y: 4, x: 11, destMapId: PALLET_TOWN, destWarpId: 0 }],
    connections: {},
  },
  {
    mapId: VIRIDIAN_CITY,
    warps: [],
    connections: { south: ROUTE_1 },
  },
];

describe("MapGraph", () => {
  let graph: MapGraph;

  beforeEach(() => {
    graph = new MapGraph();
    graph.build(TEST_MAPS);
  });

  it("build + getEdges: correct edge count and types for Pallet Town", () => {
    const edges = graph.getEdges(PALLET_TOWN);
    expect(edges).toHaveLength(2);

    const warpEdge = edges.find((e) => e.kind === "warp");
    expect(warpEdge).toBeDefined();
    expect(warpEdge).toMatchObject({
      kind: "warp",
      fromMapId: PALLET_TOWN,
      from: { y: 5, x: 3 },
      toMapId: OAKS_LAB,
      destWarpId: 0,
    });

    const connEdge = edges.find((e) => e.kind === "connection");
    expect(connEdge).toBeDefined();
    expect(connEdge).toMatchObject({
      kind: "connection",
      fromMapId: PALLET_TOWN,
      direction: "north",
      toMapId: ROUTE_1,
    });
  });

  it("build + getEdges: Oak's Lab has one warp back to Pallet", () => {
    const edges = graph.getEdges(OAKS_LAB);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      kind: "warp",
      fromMapId: OAKS_LAB,
      from: { y: 4, x: 11 },
      toMapId: PALLET_TOWN,
    });
  });

  it("getReachableMaps from Pallet: reaches all 4 maps", () => {
    const reachable = graph.getReachableMaps(PALLET_TOWN);
    expect(reachable.sort((a, b) => a - b)).toEqual(
      [PALLET_TOWN, VIRIDIAN_CITY, ROUTE_1, OAKS_LAB].sort((a, b) => a - b)
    );
  });

  it("renderForLLM with currentMapId=0: format matches design exactly", () => {
    const output = graph.renderForLLM(PALLET_TOWN);
    const lines = output.split("\n");

    expect(lines[0]).toBe("=== MAP GRAPH ===");

    // Current map first with star and suffix
    expect(lines[1]).toMatch(/^\* .+ \(map 0\) — you are here$/);

    // Pallet Town edges
    const palletSection = lines.slice(1);
    const northLine = palletSection.find((l) => l.includes("→ north:"));
    expect(northLine).toBeDefined();
    expect(northLine).toContain("Route 1");

    const warpLine = palletSection.find((l) => l.includes("→ warp(5,3):"));
    expect(warpLine).toBeDefined();

    // Other maps have no star prefix
    const otherMapLines = lines.filter((l) => l.match(/^\w.*\(map \d+\)$/));
    for (const line of otherMapLines) {
      expect(line).not.toMatch(/^\*/);
    }
  });

  it("renderForLLM with currentMapId=12: Route 1 gets the star", () => {
    const output = graph.renderForLLM(ROUTE_1);
    const lines = output.split("\n");

    // Second line should be Route 1 with star
    expect(lines[1]).toMatch(/^\* .+ \(map 12\) — you are here$/);

    // Pallet Town should appear without star
    const palletLine = lines.find((l) => l.includes("(map 0)"));
    expect(palletLine).toBeDefined();
    expect(palletLine).not.toMatch(/^\*/);
  });

  it("empty graph: renderForLLM returns minimal output", () => {
    const emptyGraph = new MapGraph();
    const output = emptyGraph.renderForLLM(0);
    expect(output).toBe("=== MAP GRAPH ===");
  });
});
