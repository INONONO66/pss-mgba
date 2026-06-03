import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PersistentMemoryKind = "mistake_resolved" | "lesson";

export interface PersistentMemoryEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly runId: string;
  readonly kind: PersistentMemoryKind;
  readonly mapId: number;
  readonly mapName: string;
  readonly badges: number;
  readonly situation: string;
  readonly resolution: string;
  readonly tags: readonly string[];
}

export interface PersistentMemoryFile {
  readonly version: 1;
  updatedAt: string;
  nextEntryId: number;
  entries: PersistentMemoryEntry[];
}

export interface PersistentMemoryQuery {
  readonly mapId?: number;
  readonly badges?: number;
  readonly badgeRange?: number;
  readonly tags?: readonly string[];
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 500;
const DEFAULT_QUERY_LIMIT = 5;
const DEFAULT_BADGE_RANGE = 1;
const ENTRY_ID_PATTERN = /^pm-(\d+)$/;

// ---------------------------------------------------------------------------
// PersistentMemory
// ---------------------------------------------------------------------------

export class PersistentMemory {
  private readonly filePath: string;
  private data: PersistentMemoryFile;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = emptyFile();
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      this.data = normalizeFile(parsed);
    } catch {
      this.data = emptyFile();
    }
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    this.data.updatedAt = new Date().toISOString();

    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.filePath);
  }

  async record(
    entry: Omit<PersistentMemoryEntry, "id" | "createdAt">,
  ): Promise<PersistentMemoryEntry> {
    const full: PersistentMemoryEntry = {
      ...entry,
      id: formatEntryId(this.data.nextEntryId),
      createdAt: new Date().toISOString(),
    };

    this.data.nextEntryId += 1;
    this.data.entries.push(full);

    if (this.data.entries.length > MAX_ENTRIES) {
      this.data.entries = this.data.entries.slice(
        this.data.entries.length - MAX_ENTRIES,
      );
    }

    await this.save();
    return full;
  }

  query(query: PersistentMemoryQuery = {}): readonly PersistentMemoryEntry[] {
    const limit = query.limit ?? DEFAULT_QUERY_LIMIT;
    const badgeRange = query.badgeRange ?? DEFAULT_BADGE_RANGE;

    let candidates = [...this.data.entries];

    if (query.mapId !== undefined) {
      const mapMatches = candidates.filter((e) => e.mapId === query.mapId);
      const nearby = candidates.filter(
        (e) =>
          e.mapId !== query.mapId &&
          matchesBadgeRange(e.badges, query.badges, badgeRange),
      );
      candidates = [...mapMatches, ...nearby];
    }

    if (query.badges !== undefined) {
      candidates = candidates.filter((e) =>
        matchesBadgeRange(e.badges, query.badges, badgeRange),
      );
    }

    if (query.tags !== undefined && query.tags.length > 0) {
      const tagSet = new Set(query.tags);
      candidates.sort((a, b) => {
        const aScore = a.tags.filter((t) => tagSet.has(t)).length;
        const bScore = b.tags.filter((t) => tagSet.has(t)).length;
        return bScore - aScore;
      });
    }

    return candidates.slice(0, limit);
  }

  get size(): number {
    return this.data.entries.length;
  }

  get entries(): readonly PersistentMemoryEntry[] {
    return this.data.entries;
  }

  snapshot(): PersistentMemoryFile {
    return {
      version: 1,
      updatedAt: this.data.updatedAt,
      nextEntryId: this.data.nextEntryId,
      entries: [...this.data.entries],
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesBadgeRange(
  entryBadges: number,
  queryBadges: number | undefined,
  range: number,
): boolean {
  if (queryBadges === undefined) {
    return true;
  }
  return Math.abs(entryBadges - queryBadges) <= range;
}

function emptyFile(): PersistentMemoryFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    nextEntryId: 1,
    entries: [],
  };
}

function formatEntryId(id: number): string {
  return `pm-${id.toString().padStart(6, "0")}`;
}

function parseEntryId(id: string): number {
  const match = ENTRY_ID_PATTERN.exec(id);
  return match === null ? 0 : Number.parseInt(match[1] ?? "0", 10);
}

function normalizeFile(parsed: unknown): PersistentMemoryFile {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>).version !== 1
  ) {
    return emptyFile();
  }

  const record = parsed as Record<string, unknown>;
  const rawEntries = record.entries;
  let highestId = 0;
  const entries: PersistentMemoryEntry[] = [];

  if (Array.isArray(rawEntries)) {
    for (const raw of rawEntries) {
      const entry = normalizeEntry(raw);
      if (entry !== null) {
        entries.push(entry);
        highestId = Math.max(highestId, parseEntryId(entry.id));
      }
    }
  }

  const persistedNextId = record.nextEntryId;
  const nextEntryId =
    typeof persistedNextId === "number" &&
    Number.isInteger(persistedNextId) &&
    persistedNextId > highestId
      ? persistedNextId
      : highestId + 1;

  return {
    version: 1,
    updatedAt:
      typeof record.updatedAt === "string"
        ? record.updatedAt
        : new Date().toISOString(),
    nextEntryId,
    entries: entries.slice(-MAX_ENTRIES),
  };
}

function normalizeEntry(raw: unknown): PersistentMemoryEntry | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.createdAt !== "string" ||
    typeof r.runId !== "string" ||
    typeof r.kind !== "string" ||
    typeof r.mapId !== "number" ||
    typeof r.mapName !== "string" ||
    typeof r.badges !== "number" ||
    typeof r.situation !== "string" ||
    typeof r.resolution !== "string"
  ) {
    return null;
  }

  if (r.kind !== "mistake_resolved" && r.kind !== "lesson") {
    return null;
  }

  return {
    id: r.id,
    createdAt: r.createdAt,
    runId: r.runId,
    kind: r.kind,
    mapId: r.mapId,
    mapName: r.mapName,
    badges: r.badges,
    situation: r.situation,
    resolution: r.resolution,
    tags: Array.isArray(r.tags)
      ? r.tags.filter((t): t is string => typeof t === "string")
      : [],
  };
}
