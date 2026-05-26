import { describe, expect, it } from "vitest";
import type { MapMemoryResponse } from "../../viewer/src/api/types.js";
import { mapMemoryStats, renderPersistedMap, visualGraphFromMapMemory, visualGraphFromText } from "../../viewer/src/components/mapVisuals.js";

describe("map visual helpers", () => {
  it("renders persisted map tiles with warp overlays and stats", () => {
    const payload: MapMemoryResponse = {
      runId: "map-run",
      maps: {
        1: {
          mapId: 1,
          width: 3,
          height: 2,
          tiles: {
            "0,0": { terrain: "walkable", features: [], tileId: 1 },
            "0,1": { terrain: "wall", features: [], tileId: 2 },
            "1,2": { terrain: "grass", features: [], tileId: 3 },
          },
          warps: [{ y: 0, x: 2, destMapId: 2, destWarpId: 0 }],
          connections: { north: 3 },
        },
      },
    };

    expect(mapMemoryStats(payload)).toEqual({ mapCount: 1, tileCount: 3, warpCount: 1, connectionCount: 1 });
    expect(renderPersistedMap(payload.maps!["1"])).toContain("0 .#W");
    const graph = visualGraphFromMapMemory(payload);
    expect(graph.nodeCount).toBe(3);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "connection", detail: "north", toMapId: 3 }),
      expect.objectContaining({ kind: "warp", toMapId: 2 }),
    ]));
  });

  it("parses textual turn map graph into visual edges", () => {
    const graph = visualGraphFromText([
      "=== MAP GRAPH ===",
      "* Pallet Town (map 0) — you are here",
      "  → north: Route 1",
      "  → warp(5,7): Reds House 1F",
      "Route 1 (map 12)",
      "  → south: Pallet Town",
    ].join("\n"));

    expect(graph.currentLabel).toBe("Pallet Town");
    expect(graph.nodeCount).toBe(3);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromLabel: "Pallet Town", detail: "north", toLabel: "Route 1" }),
      expect.objectContaining({ fromLabel: "Pallet Town", kind: "warp", toLabel: "Reds House 1F" }),
    ]));
  });
  it("documents the raw map-graph text parser contract", () => {
    const graph = visualGraphFromText("Pallet Town -> Route 1");

    expect(graph).toEqual({ edges: [], nodeCount: 0 });
  });

});
