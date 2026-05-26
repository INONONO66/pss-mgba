import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MapRecord } from "../../src/game/MapMemory.js";
import type { TileFeature } from "../../src/game/TilesetData.js";
import {
  fromPersistedMap,
  MapMemoryStore,
  toPersistedMap,
  type MapMemoryFile,
  type PersistedMapRecord,
} from "../../src/game/MapMemoryStore.js";
import type { WarpEntry } from "../../src/game/WarpReader.js";

const TMP_BASE = "/var/folders/70/44j59lmn1x95z003s9fg4qlm0000gn/T/opencode";

function uniqueDir(prefix: string): string {
  return path.join(TMP_BASE, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function makeMapRecord(mapId: number): MapRecord {
  const tiles = new Map<string, { terrain: "walkable" | "wall" | "grass" | "water"; features: readonly TileFeature[]; tileId: number }>();
  tiles.set("0,0", { terrain: "walkable", features: [], tileId: 1 });
  tiles.set("1,0", { terrain: "wall", features: [], tileId: 2 });
  tiles.set("2,1", { terrain: "grass", features: [], tileId: 3 });
  return {
    mapId,
    width: 10,
    height: 10,
    tiles,
    npcPositions: [{ y: 5, x: 5 }], // should NOT be persisted
    knownNpcs: new Map([[1, { slot: 1, pictureId: 2, mapY: 5, mapX: 5, movementType: "stationary", onScreen: true, lastSeenTurn: 1 }]]),
  };
}

function makeWarps(): WarpEntry[] {
  return [
    { y: 0, x: 3, destMapId: 42, destWarpId: 1 },
    { y: 9, x: 7, destMapId: 99, destWarpId: 0 },
  ];
}

function makeConnections(): Partial<Record<"north" | "south" | "east" | "west", number>> {
  return { north: 5, east: 12 };
}

// ---------------------------------------------------------------------------
// 1. Round-trip: create data → save → load → compare
// ---------------------------------------------------------------------------
describe("MapMemoryStore", () => {
  it("round-trips map data through save and load", async () => {
    const dir = uniqueDir("roundtrip");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "map-memory.v1.json");
    const store = new MapMemoryStore(filePath);

    const record = makeMapRecord(3);
    const warps = makeWarps();
    const connections = makeConnections();

    const persisted = toPersistedMap(record, warps, connections);
    const data: MapMemoryFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      maps: { "3": persisted },
    };

    await store.save(data);
    const loaded = await store.load();

    expect(loaded.version).toBe(1);
    expect(Object.keys(loaded.maps)).toContain("3");

    const loadedMap = loaded.maps["3"] as PersistedMapRecord;
    expect(loadedMap.mapId).toBe(3);
    expect(loadedMap.width).toBe(10);
    expect(loadedMap.height).toBe(10);

    // Tiles match
    expect(loadedMap.tiles["0,0"]).toEqual({ terrain: "walkable", features: [], tileId: 1 });
    expect(loadedMap.tiles["1,0"]).toEqual({ terrain: "wall", features: [], tileId: 2 });
    expect(loadedMap.tiles["2,1"]).toEqual({ terrain: "grass", features: [], tileId: 3 });

    // Warps match
    expect(loadedMap.warps).toHaveLength(2);
    expect(loadedMap.warps[0]).toEqual({ y: 0, x: 3, destMapId: 42, destWarpId: 1 });

    // Connections match
    expect(loadedMap.connections).toEqual({ north: 5, east: 12 });

    // NPC positions NOT persisted
    expect("npcPositions" in loadedMap).toBe(false);

    store.dispose();
  });

  // ---------------------------------------------------------------------------
  // 2. Debounce: markDirty 3 times rapidly → only 1 save
  // ---------------------------------------------------------------------------
  it("debounces saves — only 1 save fires after 3 rapid markDirty calls", async () => {
    vi.useFakeTimers();

    const dir = uniqueDir("debounce");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "map-memory.v1.json");
    const store = new MapMemoryStore(filePath, 500);

    const data: MapMemoryFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      maps: {},
    };

    const saveSpy = vi.spyOn(store, "save");

    store.markDirty(data);
    store.markDirty(data);
    store.markDirty(data);

    // No save yet
    expect(saveSpy).not.toHaveBeenCalled();

    // Advance past debounce window
    await vi.runAllTimersAsync();

    expect(saveSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    store.dispose();
  });

  // ---------------------------------------------------------------------------
  // 3. Flush: markDirty then flush → saves immediately
  // ---------------------------------------------------------------------------
  it("flush saves immediately and cancels pending timer", async () => {
    vi.useFakeTimers();

    const dir = uniqueDir("flush");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "map-memory.v1.json");
    const store = new MapMemoryStore(filePath, 5000);

    const data: MapMemoryFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      maps: {},
    };

    const saveSpy = vi.spyOn(store, "save");

    store.markDirty(data);
    expect(saveSpy).not.toHaveBeenCalled();

    // flush should save immediately without waiting for timer
    vi.useRealTimers();
    await store.flush(data);

    expect(saveSpy).toHaveBeenCalledTimes(1);

    store.dispose();
  });

  // ---------------------------------------------------------------------------
  // 4. Missing file: load() returns empty structure
  // ---------------------------------------------------------------------------
  it("returns empty structure when file does not exist", async () => {
    const dir = uniqueDir("missing");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "nonexistent.json");
    const store = new MapMemoryStore(filePath);

    const result = await store.load();

    expect(result.version).toBe(1);
    expect(result.maps).toEqual({});
    expect(typeof result.updatedAt).toBe("string");

    store.dispose();
  });

  // ---------------------------------------------------------------------------
  // 5. Atomic write: .tmp file doesn't remain after save
  // ---------------------------------------------------------------------------
  it("does not leave a .tmp file after save", async () => {
    const dir = uniqueDir("atomic");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "map-memory.v1.json");
    const tmpPath = `${filePath}.tmp`;
    const store = new MapMemoryStore(filePath);

    const data: MapMemoryFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      maps: {},
    };

    await store.save(data);

    // Main file should exist
    await expect(stat(filePath)).resolves.toMatchObject({ size: expect.any(Number) });

    // .tmp file should NOT exist
    await expect(access(tmpPath)).rejects.toThrow();

    store.dispose();
  });

  // ---------------------------------------------------------------------------
  // 6. Directory creation: works even if .local-data/ doesn't exist
  // ---------------------------------------------------------------------------
  it("creates missing directories automatically on load and save", async () => {
    const dir = uniqueDir("autocreate");
    // Do NOT pre-create the directory
    const filePath = path.join(dir, "nested", "deep", "map-memory.v1.json");
    const store = new MapMemoryStore(filePath);

    // load() should auto-create the directory
    const result = await store.load();
    expect(result.version).toBe(1);

    // save() should also work
    const data: MapMemoryFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      maps: {},
    };
    await store.save(data);

    const content = await readFile(filePath, "utf8");
    expect(JSON.parse(content)).toMatchObject({ version: 1 });

    store.dispose();
  });

  // ---------------------------------------------------------------------------
  // Conversion: fromPersistedMap restores MapRecord correctly
  // ---------------------------------------------------------------------------
  it("fromPersistedMap restores tiles as a Map and clears npcPositions", () => {
    const record = makeMapRecord(7);
    const warps = makeWarps();
    const connections = makeConnections();

    const persisted = toPersistedMap(record, warps, connections);
    const { mapRecord, warps: restoredWarps } = fromPersistedMap(persisted);

    expect(mapRecord.mapId).toBe(7);
    expect(mapRecord.tiles).toBeInstanceOf(Map);
    expect(mapRecord.tiles.get("0,0")).toEqual({ terrain: "walkable", features: [], tileId: 1 });
    expect(mapRecord.tiles.get("1,0")).toEqual({ terrain: "wall", features: [], tileId: 2 });
    expect(mapRecord.tiles.get("2,1")).toEqual({ terrain: "grass", features: [], tileId: 3 });
    expect(mapRecord.npcPositions).toEqual([]);

    expect(restoredWarps).toHaveLength(2);
    expect(restoredWarps[0]).toEqual({ y: 0, x: 3, destMapId: 42, destWarpId: 1 });
  });

  // ---------------------------------------------------------------------------
  // Corrupt JSON: load() returns empty structure gracefully
  // ---------------------------------------------------------------------------
  it("returns empty structure when JSON is corrupt", async () => {
    const dir = uniqueDir("corrupt");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "map-memory.v1.json");

    // Write corrupt JSON
    await import("node:fs/promises").then((fs) => fs.writeFile(filePath, "{ not valid json !!!", "utf8"));

    const store = new MapMemoryStore(filePath);
    const result = await store.load();

    expect(result.version).toBe(1);
    expect(result.maps).toEqual({});

    store.dispose();
  });
});
