import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MapRecord } from "./MapMemory.js";
import type { WarpEntry } from "./WarpReader.js";

// ---------------------------------------------------------------------------
// Persisted Types
// ---------------------------------------------------------------------------

export interface MapMemoryFile {
  version: 1;
  updatedAt: string;
  maps: Record<string, PersistedMapRecord>;
}

export interface PersistedMapRecord {
  mapId: number;
  width: number;
  height: number;
  tiles: Record<string, PersistedTile>;
  warps: PersistedWarp[];
  connections: Partial<Record<"north" | "south" | "east" | "west", number>>;
}

export interface PersistedTile {
  type: "walkable" | "wall" | "grass";
  tileId: number;
}

export interface PersistedWarp {
  y: number;
  x: number;
  destMapId: number;
  destWarpId: number;
}

// ---------------------------------------------------------------------------
// Store Class
// ---------------------------------------------------------------------------

export class MapMemoryStore {
  private readonly filePath: string;
  private dirty = false;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly debounceMs: number;

  constructor(filePath: string, debounceMs = 2000) {
    this.filePath = filePath;
    this.debounceMs = debounceMs;
  }

  /**
   * Load from disk. Returns empty structure if file doesn't exist.
   * Gracefully handles corrupt JSON.
   */
  async load(): Promise<MapMemoryFile> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as Record<string, unknown>)["version"] !== 1
      ) {
        return emptyFile();
      }

      return parsed as MapMemoryFile;
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") {
        return emptyFile();
      }
      // Corrupt JSON or other read error — return empty rather than crash.
      return emptyFile();
    }
  }

  /**
   * Save immediately using atomic write (.tmp → rename).
   */
  async save(data: MapMemoryFile): Promise<void> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    data.updatedAt = new Date().toISOString();
    const json = JSON.stringify(data, null, 2);
    const tmpPath = `${this.filePath}.tmp`;

    await writeFile(tmpPath, json, "utf8");
    await rename(tmpPath, this.filePath);

    this.dirty = false;
  }

  /**
   * Mark dirty → triggers debounced save after debounceMs.
   */
  markDirty(data: MapMemoryFile): void {
    this.dirty = true;

    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.save(data);
    }, this.debounceMs);
  }

  /**
   * Force immediate save if dirty or timer pending.
   */
  async flush(data: MapMemoryFile): Promise<void> {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    if (this.dirty) {
      await this.save(data);
    }
  }

  /**
   * Cancel pending debounce timer without saving.
   */
  dispose(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Conversion Functions
// ---------------------------------------------------------------------------

/**
 * Convert runtime MapRecord + warps + connections to PersistedMapRecord.
 * NPC positions are intentionally NOT persisted.
 */
export function toPersistedMap(
  record: MapRecord,
  warps: WarpEntry[],
  connections: Partial<Record<"north" | "south" | "east" | "west", number>>,
): PersistedMapRecord {
  const tiles: Record<string, PersistedTile> = {};
  for (const [key, tile] of record.tiles) {
    tiles[key] = {
      type: tile.type,
      tileId: tile.tileId,
    };
  }

  const persistedWarps: PersistedWarp[] = warps.map((w) => ({
    y: w.y,
    x: w.x,
    destMapId: w.destMapId,
    destWarpId: w.destWarpId,
  }));

  return {
    mapId: record.mapId,
    width: record.width,
    height: record.height,
    tiles,
    warps: persistedWarps,
    connections,
  };
}

/**
 * Convert PersistedMapRecord back to runtime MapRecord + warps.
 * npcPositions and knownNpcs are initialized to empty (not persisted).
 */
export function fromPersistedMap(persisted: PersistedMapRecord): {
  mapRecord: MapRecord;
  warps: WarpEntry[];
} {
  const tiles = new Map<string, { type: "walkable" | "wall" | "grass"; tileId: number }>();

  for (const [key, tile] of Object.entries(persisted.tiles)) {
    tiles.set(key, {
      type: tile.type,
      tileId: tile.tileId,
    });
  }

  const mapRecord: MapRecord = {
    mapId: persisted.mapId,
    width: persisted.width,
    height: persisted.height,
    tiles,
    npcPositions: [],
    knownNpcs: new Map(),
  };

  const warps: WarpEntry[] = persisted.warps.map((w) => ({
    y: w.y,
    x: w.x,
    destMapId: w.destMapId,
    destWarpId: w.destWarpId,
  }));

  return { mapRecord, warps };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyFile(): MapMemoryFile {
  return { version: 1, updatedAt: new Date().toISOString(), maps: {} };
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
