import { mapName } from "./PokemonCatalog.js";

type ConnectionDirection = "north" | "south" | "east" | "west";

interface WarpEdge {
  kind: "warp";
  fromMapId: number;
  from: { y: number; x: number };
  toMapId: number;
  destWarpId: number;
}

interface ConnectionEdge {
  kind: "connection";
  fromMapId: number;
  direction: ConnectionDirection;
  toMapId: number;
}

type MapGraphEdge = WarpEdge | ConnectionEdge;

export interface MapGraphInput {
  mapId: number;
  warps: ReadonlyArray<{ y: number; x: number; destMapId: number; destWarpId: number }>;
  connections: Partial<Record<ConnectionDirection, number>>;
}

export class MapGraph {
  private readonly edges = new Map<number, MapGraphEdge[]>();
  private readonly visitedMapIds = new Set<number>();

  build(maps: Iterable<MapGraphInput>): void {
    this.edges.clear();
    this.visitedMapIds.clear();

    for (const map of maps) {
      this.visitedMapIds.add(map.mapId);

      const edgeList: MapGraphEdge[] = [];

      for (const warp of map.warps) {
        if (warp.destMapId === 0xff) {
          continue;
        }
        edgeList.push({
          kind: "warp",
          fromMapId: map.mapId,
          from: { y: warp.y, x: warp.x },
          toMapId: warp.destMapId,
          destWarpId: warp.destWarpId,
        });
      }

      const directions: ConnectionDirection[] = ["north", "south", "east", "west"];
      for (const dir of directions) {
        const toMapId = map.connections[dir];
        if (toMapId !== undefined) {
          edgeList.push({
            kind: "connection",
            fromMapId: map.mapId,
            direction: dir,
            toMapId,
          });
        }
      }

      this.edges.set(map.mapId, edgeList);
    }
  }

  getEdges(mapId: number): readonly MapGraphEdge[] {
    return this.edges.get(mapId) ?? [];
  }

  getReachableMaps(fromMapId: number): number[] {
    const visited = new Set<number>();
    const queue: number[] = [fromMapId];
    visited.add(fromMapId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of this.getEdges(current)) {
        const next = edge.toMapId;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    return Array.from(visited);
  }

  getVisitedMaps(): number[] {
    return Array.from(this.visitedMapIds);
  }

  renderForLLM(currentMapId: number): string {
    const lines: string[] = ["=== MAP GRAPH ==="];

    const visited = Array.from(this.visitedMapIds);

    if (visited.length === 0) {
      return lines.join("\n");
    }

    // Sort: current map first, then alphabetical by name
    const sorted = visited.slice().sort((a, b) => {
      if (a === currentMapId) return -1;
      if (b === currentMapId) return 1;
      return mapName(a).localeCompare(mapName(b));
    });

    for (const mapId of sorted) {
      const name = mapName(mapId);
      const isCurrent = mapId === currentMapId;
      const prefix = isCurrent ? "* " : "";
      const suffix = isCurrent ? " — you are here" : "";
      lines.push(`${prefix}${name} (map ${mapId})${suffix}`);

      for (const edge of this.getEdges(mapId)) {
        if (edge.kind === "connection") {
          lines.push(`  → ${edge.direction}: ${mapName(edge.toMapId)}`);
        } else {
          lines.push(`  → warp(${edge.from.y},${edge.from.x}): ${mapName(edge.toMapId)}`);
        }
      }
    }

    return lines.join("\n");
  }
}
