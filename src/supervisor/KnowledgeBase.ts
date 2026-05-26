import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface KnowledgeEntry {
  readonly situationKey: string;
  readonly advice: string;
  readonly mapId?: number;
  readonly badges?: number;
  readonly outcome?: "helped" | "unhelpful" | "unknown";
  readonly createdAt: string;
  readonly usedCount: number;
}

export interface KnowledgeBaseFile {
  readonly version: 1;
  readonly updatedAt: string;
  readonly entries: KnowledgeEntry[];
}

const MAX_ENTRIES = 200;
interface MutableKnowledgeEntry {
  situationKey: string;
  advice: string;
  mapId?: number;
  badges?: number;
  outcome?: KnowledgeEntry["outcome"];
  createdAt: string;
  usedCount: number;
}

export class KnowledgeBase {
  private readonly filePath: string;
  private entriesList: MutableKnowledgeEntry[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      this.entriesList = parseKnowledgeFile(parsed);
    } catch {
      this.entriesList = [];
    }
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    const data: KnowledgeBaseFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: this.entriesList,
    };

    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
    await rename(tmpPath, this.filePath);
  }

  lookup(situationKey: string): KnowledgeEntry | undefined {
    const entry = this.entriesList.find((candidate) => candidate.situationKey === situationKey);
    if (!entry) {
      return;
    }

    entry.usedCount += 1;
    return entry;
  }

  record(entry: Omit<KnowledgeEntry, "usedCount" | "createdAt">): void {
    const now = new Date().toISOString();
    const nextEntry: MutableKnowledgeEntry = {
      situationKey: entry.situationKey,
      advice: entry.advice,
      mapId: entry.mapId,
      badges: entry.badges,
      outcome: entry.outcome,
      createdAt: now,
      usedCount: 0,
    };

    const existingIndex = this.entriesList.findIndex((candidate) => candidate.situationKey === entry.situationKey);
    if (existingIndex >= 0) {
      this.entriesList[existingIndex] = nextEntry;
    } else {
      this.entriesList.push(nextEntry);
    }

    if (this.entriesList.length > MAX_ENTRIES) {
      this.entriesList = [...this.entriesList]
        .sort((left, right) => compareEntries(left, right))
        .slice(this.entriesList.length - MAX_ENTRIES);
    }
  }

  markOutcome(situationKey: string, outcome: KnowledgeEntry["outcome"]): void {
    const entry = this.entriesList.find((candidate) => candidate.situationKey === situationKey);
    if (entry) {
      entry.outcome = outcome;
    }
  }

  get size(): number {
    return this.entriesList.length;
  }

  get entries(): readonly KnowledgeEntry[] {
    return this.entriesList;
  }
}

function compareEntries(left: MutableKnowledgeEntry, right: MutableKnowledgeEntry): number {
  if (left.usedCount !== right.usedCount) {
    return left.usedCount - right.usedCount;
  }

  if (left.createdAt < right.createdAt) {
    return -1;
  }

  if (left.createdAt > right.createdAt) {
    return 1;
  }

  return 0;
}

function parseKnowledgeFile(parsed: unknown): MutableKnowledgeEntry[] {
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    return [];
  }

  const entries: MutableKnowledgeEntry[] = [];
  for (const rawEntry of parsed.entries) {
    if (!isKnowledgeEntry(rawEntry)) {
      continue;
    }

    entries.push({
      situationKey: rawEntry.situationKey,
      advice: rawEntry.advice,
      mapId: rawEntry.mapId,
      badges: rawEntry.badges,
      outcome: rawEntry.outcome,
      createdAt: rawEntry.createdAt,
      usedCount: rawEntry.usedCount,
    });
  }

  return entries;
}

function isKnowledgeEntry(value: unknown): value is MutableKnowledgeEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.situationKey === "string" &&
    typeof value.advice === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.usedCount === "number" &&
    (value.mapId === undefined || typeof value.mapId === "number") &&
    (value.badges === undefined || typeof value.badges === "number") &&
    (value.outcome === undefined || value.outcome === "helped" || value.outcome === "unhelpful" || value.outcome === "unknown")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
