import type { MapMemoryResponse, PersistedMapRecord } from "../api/types";
import { isRecord, json, value } from "./shared";

export interface VisualGraphEdge {
  readonly detail?: string;
  readonly fromLabel: string;
  readonly fromMapId?: number;
  readonly kind: "connection" | "warp" | "graph";
  readonly toLabel: string;
  readonly toMapId?: number;
}

export interface VisualGraph {
  readonly currentLabel?: string;
  readonly edges: VisualGraphEdge[];
  readonly nodeCount: number;
}

export interface MapMemoryStats {
  readonly mapCount: number;
  readonly tileCount: number;
  readonly warpCount: number;
  readonly connectionCount: number;
}

export function mapMemoryStats(payload: MapMemoryResponse | null): MapMemoryStats {
  const entries = Object.entries(payload?.maps ?? {});
  return {
    mapCount: entries.length,
    tileCount: entries.reduce((sum, [, record]) => sum + tileCount(record), 0),
    warpCount: entries.reduce((sum, [, record]) => sum + warpCount(record), 0),
    connectionCount: entries.reduce((sum, [, record]) => sum + connectionCount(record), 0),
  };
}

export function visualGraphFromMapMemory(payload: MapMemoryResponse | null): VisualGraph {
  const maps = payload?.maps ?? {};
  const edges: VisualGraphEdge[] = [];
  const nodeKeys = new Set<string>();
  for (const [fallbackMapId, record] of Object.entries(maps)) {
    const fromMapId = numberValue(record.mapId, Number(fallbackMapId));
    const fromLabel = `맵 ${value(fromMapId, fallbackMapId)}`;
    nodeKeys.add(nodeKey(fromMapId, fromLabel));
    if (isRecord(record.connections)) {
      for (const [direction, target] of Object.entries(record.connections)) {
        const toMapId = numberValue(target);
        const toLabel = `맵 ${value(toMapId, value(target))}`;
        nodeKeys.add(nodeKey(toMapId, toLabel));
        edges.push({ fromLabel, fromMapId, kind: "connection", detail: direction, toLabel, toMapId });
      }
    }
    for (const warp of Array.isArray(record.warps) ? record.warps : []) {
      if (!isRecord(warp)) continue;
      const toMapId = numberValue(warp.destMapId);
      const toLabel = `맵 ${value(toMapId, value(warp.destMapId))}`;
      nodeKeys.add(nodeKey(toMapId, toLabel));
      edges.push({
        fromLabel,
        fromMapId,
        kind: "warp",
        detail: `(${value(warp.y)},${value(warp.x)}) → warp ${value(warp.destWarpId)}`,
        toLabel,
        toMapId,
      });
    }
  }
  return { edges, nodeCount: nodeKeys.size };
}

export function visualGraphFromText(text: string | undefined): VisualGraph {
  if (text === undefined || text.trim().length === 0) {
    return { edges: [], nodeCount: 0 };
  }

  const nodeNames = new Set<string>();
  const edges: VisualGraphEdge[] = [];
  let currentNode: { label: string; mapId?: number; current?: boolean } | undefined;
  let currentLabel: string | undefined;

  for (const line of text.split("\n")) {
    const node = line.match(/^\*?\s*([^\n(]+?)\s+\(map\s+(\d+)\)(?:\s+—\s+you are here)?\s*$/);
    if (node) {
      currentNode = {
        label: node[1].trim(),
        mapId: Number(node[2]),
        current: line.trimStart().startsWith("*"),
      };
      nodeNames.add(currentNode.label);
      if (currentNode.current) currentLabel = currentNode.label;
      continue;
    }

    const edge = line.match(/^\s*→\s+([^:]+):\s+(.+?)\s*$/);
    if (edge && currentNode !== undefined) {
      const detail = edge[1].trim();
      const target = edge[2].trim();
      nodeNames.add(target);
      edges.push({
        fromLabel: currentNode.label,
        fromMapId: currentNode.mapId,
        kind: detail.startsWith("warp") ? "warp" : "graph",
        detail,
        toLabel: target,
      });
    }
  }

  return { currentLabel, edges, nodeCount: nodeNames.size };
}

export function renderPersistedMap(record: PersistedMapRecord): string {
  const width = numberValue(record.width);
  const height = numberValue(record.height);
  const tiles = isRecord(record.tiles) ? record.tiles : {};
  const warps = Array.isArray(record.warps) ? record.warps : [];
  if (width <= 0 || height <= 0) return json(record);
  const warpSet = new Set(warps.flatMap((warp) => isRecord(warp) ? [`${warp.y},${warp.x}`] : []));
  const lines: string[] = [];
  lines.push(`   ${Array.from({ length: width }, (_, index) => (index % 10).toString()).join("")}`);
  for (let y = 0; y < height; y += 1) {
    let line = `${y.toString().padStart(2, " ")} `;
    for (let x = 0; x < width; x += 1) {
      const key = `${y},${x}`;
      line += warpSet.has(key) ? "W" : tileChar(tiles[key]);
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export function tileCount(record: unknown): number {
  return isRecord(record) && isRecord(record.tiles) ? Object.keys(record.tiles).length : 0;
}

export function warpCount(record: unknown): number {
  return isRecord(record) && Array.isArray(record.warps) ? record.warps.length : 0;
}

export function connectionCount(record: unknown): number {
  return isRecord(record) && isRecord(record.connections) ? Object.keys(record.connections).length : 0;
}

export function connectionChips(record: PersistedMapRecord): string[] {
  if (!isRecord(record.connections)) return [];
  return Object.entries(record.connections).map(([direction, target]) => `${direction} → ${value(target)}`);
}

function tileChar(tile: unknown): string {
  if (!isRecord(tile)) return "?";
  const terrain = tile.terrain ?? tile.type;
  if (terrain === "wall") return "#";
  if (terrain === "grass") return '"';
  if (terrain === "water") return "~";
  if (terrain === "walkable") return ".";
  return "?";
}

function numberValue(input: unknown, fallback = 0): number {
  return typeof input === "number" && Number.isFinite(input) ? input : fallback;
}

function nodeKey(mapId: number | undefined, label: string): string {
  return mapId === undefined ? label : `map:${mapId}`;
}
