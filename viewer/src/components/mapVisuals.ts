import type { MapMemoryResponse, PersistedMapRecord, PersistedNpc } from "../api/types";
import { isRecord, json, value } from "./shared";

const FIRST_STILL_SPRITE = 0x3d;

const SPRITE_NAMES: Readonly<Record<number, string>> = {
  0x01: "Red", 0x02: "Blue", 0x03: "Oak", 0x04: "Youngster", 0x05: "Monster",
  0x06: "Cooltrainer F", 0x07: "Cooltrainer M", 0x08: "Little Girl", 0x09: "Bird",
  0x0a: "Middle Aged Man", 0x0b: "Gambler", 0x0c: "Super Nerd", 0x0d: "Girl",
  0x0e: "Hiker", 0x0f: "Beauty", 0x10: "Gentleman", 0x11: "Daisy", 0x12: "Biker",
  0x13: "Sailor", 0x14: "Cook", 0x15: "Bike Shop Clerk", 0x16: "Mr. Fuji",
  0x17: "Giovanni", 0x18: "Rocket", 0x19: "Channeler", 0x1a: "Waiter",
  0x1b: "Silph Worker F", 0x1c: "Middle Aged Woman", 0x1d: "Brunette Girl",
  0x1e: "Lance", 0x20: "Scientist", 0x21: "Rocker", 0x22: "Swimmer",
  0x23: "Safari Zone Worker", 0x24: "Gym Guide", 0x25: "Gramps", 0x26: "Clerk",
  0x27: "Fishing Guru", 0x28: "Granny", 0x29: "Nurse", 0x2a: "Link Receptionist",
  0x2b: "Silph President", 0x2c: "Silph Worker M", 0x2d: "Warden", 0x2e: "Captain",
  0x2f: "Fisher", 0x30: "Koga", 0x31: "Guard", 0x33: "Mom", 0x34: "Balding Guy",
  0x35: "Little Boy", 0x37: "Gameboy Kid", 0x38: "Fairy", 0x39: "Agatha",
  0x3a: "Bruno", 0x3b: "Lorelei", 0x3c: "Seel",
  0x3d: "Poke Ball", 0x3e: "Fossil", 0x3f: "Boulder", 0x40: "Paper",
  0x41: "Pokedex", 0x42: "Clipboard", 0x43: "Snorlax", 0x45: "Old Amber",
  0x48: "Gambler Asleep",
};

function spriteName(pictureId: number): string {
  return SPRITE_NAMES[pictureId] ?? `sprite:${pictureId}`;
}

function isItemSprite(pictureId: number): boolean {
  return pictureId >= FIRST_STILL_SPRITE;
}

export interface NpcCellInfo {
  readonly slot: number;
  readonly pictureId: number;
  readonly name: string;
  readonly kind: "npc" | "item";
  readonly mapY: number;
  readonly mapX: number;
}

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

interface MapMemoryStats {
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

  const nameByMapId = new Map<number, string>();
  for (const [fallbackMapId, record] of Object.entries(maps)) {
    const id = numberValue(record.mapId, Number(fallbackMapId));
    if (typeof record.name === "string" && record.name.length > 0) {
      nameByMapId.set(id, record.name);
    }
  }

  function mapLabel(mapId: number, fallbackId?: string): string {
    const name = nameByMapId.get(mapId);
    return name ? `${name} (${mapId})` : `맵 ${value(mapId, value(fallbackId))}`;
  }

  for (const [fallbackMapId, record] of Object.entries(maps)) {
    const fromMapId = numberValue(record.mapId, Number(fallbackMapId));
    const fromLabel = mapLabel(fromMapId, fallbackMapId);
    nodeKeys.add(nodeKey(fromMapId, fromLabel));
    if (isRecord(record.connections)) {
      for (const [direction, target] of Object.entries(record.connections)) {
        const toMapId = numberValue(target);
        const toLabel = mapLabel(toMapId);
        nodeKeys.add(nodeKey(toMapId, toLabel));
        edges.push({ fromLabel, fromMapId, kind: "connection", detail: direction, toLabel, toMapId });
      }
    }
    for (const warp of Array.isArray(record.warps) ? record.warps : []) {
      if (!isRecord(warp)) continue;
      const toMapId = numberValue(warp.destMapId);
      if (toMapId === 0xff) continue;
      const toLabel = mapLabel(toMapId);
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

export function buildNpcCellMap(record: PersistedMapRecord): Map<string, NpcCellInfo> {
  const npcs: PersistedNpc[] = Array.isArray(record.knownNpcs) ? record.knownNpcs : [];
  const result = new Map<string, NpcCellInfo>();
  for (const npc of npcs) {
    if (typeof npc.mapY !== "number" || typeof npc.mapX !== "number") continue;
    const pid = typeof npc.pictureId === "number" ? npc.pictureId : 0;
    result.set(`${npc.mapY},${npc.mapX}`, {
      slot: typeof npc.slot === "number" ? npc.slot : 0,
      pictureId: pid,
      name: spriteName(pid),
      kind: isItemSprite(pid) ? "item" : "npc",
      mapY: npc.mapY,
      mapX: npc.mapX,
    });
  }
  return result;
}

export function renderPersistedMap(record: PersistedMapRecord): string {
  const width = numberValue(record.width);
  const height = numberValue(record.height);
  const tiles = isRecord(record.tiles) ? record.tiles : {};
  const warps = Array.isArray(record.warps) ? record.warps : [];
  if (width <= 0 || height <= 0) return json(record);
  const warpSet = new Set(warps.flatMap((warp) => isRecord(warp) ? [`${warp.y},${warp.x}`] : []));
  const npcCells = buildNpcCellMap(record);
  const playerKey = isRecord(record.playerPosition) && typeof record.playerPosition.y === "number" && typeof record.playerPosition.x === "number" ? `${record.playerPosition.y},${record.playerPosition.x}` : undefined;
  const lines: string[] = [];
  lines.push(`   ${Array.from({ length: width }, (_, index) => (index % 10).toString()).join("")}`);
  for (let y = 0; y < height; y += 1) {
    let line = `${y.toString().padStart(2, " ")} `;
    for (let x = 0; x < width; x += 1) {
      const key = `${y},${x}`;
      const npc = npcCells.get(key);
      if (playerKey === key) { line += "@"; }
      else if (npc !== undefined) { line += npc.kind === "item" ? "I" : "N"; }
      else if (warpSet.has(key)) { line += "W"; }
      else { line += tileChar(tiles[key]); }
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
