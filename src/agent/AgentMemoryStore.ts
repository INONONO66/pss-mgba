import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildRunPaths } from "../evidence/RunPaths";

export const AGENT_MEMORY_SECTIONS = [
  "objectives",
  "journal",
  "notes",
  "strategy",
  "landmarks",
  "lessons",
] as const;

export type AgentMemorySection = (typeof AGENT_MEMORY_SECTIONS)[number];

export const AGENT_MEMORY_MAX_ENTRY_CHARS = 500;
export const AGENT_MEMORY_MAX_ENTRIES_PER_SECTION = 20;


const entryIdPattern = /^mem-(\d+)$/;

export interface AgentMemoryEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly content: string;
}

type AgentMemorySections = Record<AgentMemorySection, AgentMemoryEntry[]>;

export interface AgentMemoryFile {
  readonly version: 1;
  updatedAt: string;
  nextEntryId: number;
  sections: AgentMemorySections;
}

export interface AgentMemoryStoreOptions {
  readonly evidenceDir?: string;
  readonly filePath?: string;
  readonly now?: () => Date;
  readonly runId?: string;
}

export interface AgentMemoryWriteResult {
  readonly entry: AgentMemoryEntry;
  readonly evicted: number;
  readonly section: AgentMemorySection;
  readonly totalEntries: number;
}

export interface AgentMemoryDeleteResult {
  readonly deleted: boolean;
  readonly id: string;
  readonly section: AgentMemorySection;
  readonly totalEntries: number;
}

export interface AgentMemoryReplaceResult {
  readonly entry?: AgentMemoryEntry;
  readonly id: string;
  readonly replaced: boolean;
  readonly section: AgentMemorySection;
  readonly totalEntries: number;
}

export class AgentMemoryStore {
  readonly filePath: string;

  private data: AgentMemoryFile;
  private readonly now: () => Date;

  constructor(options: AgentMemoryStoreOptions = {}) {
    if (options.filePath === undefined && options.runId === undefined) {
      throw new Error("AgentMemoryStore requires either filePath or runId");
    }

    this.filePath =
      options.filePath ??
      buildRunPaths(options.evidenceDir ?? "runs", options.runId as string).agentMemoryFile;
    this.now = options.now ?? (() => new Date());
    this.data = emptyFile(this.timestamp());
  }

  async load(): Promise<AgentMemoryFile> {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      this.data = normalizeFile(parsed, this.timestamp());
    } catch (err) {
      if (!isNodeError(err) || err.code !== "ENOENT") {
        this.data = emptyFile(this.timestamp());
      }
    }

    return this.snapshot();
  }

  read(section: string): readonly AgentMemoryEntry[] {
    assertMemorySection(section);
    return [...this.data.sections[section]];
  }

  snapshot(): AgentMemoryFile {
    return cloneFile(this.data);
  }

  async write(section: string, content: string): Promise<AgentMemoryWriteResult> {
    assertMemorySection(section);
    assertContent(content);

    const entry: AgentMemoryEntry = {
      id: formatEntryId(this.data.nextEntryId),
      createdAt: this.timestamp(),
      content,
    };

    this.data.nextEntryId += 1;
    const entries = [...this.data.sections[section], entry];
    const evicted = Math.max(0, entries.length - AGENT_MEMORY_MAX_ENTRIES_PER_SECTION);
    this.data.sections[section] = entries.slice(-AGENT_MEMORY_MAX_ENTRIES_PER_SECTION);

    await this.save();

    return {
      entry,
      evicted,
      section,
      totalEntries: this.data.sections[section].length,
    };
  }

  async delete(section: string, id: string): Promise<AgentMemoryDeleteResult> {
    assertMemorySection(section);
    const before = this.data.sections[section];
    const after = before.filter((entry) => entry.id !== id);
    const deleted = after.length !== before.length;
    this.data.sections[section] = after;

    if (deleted) {
      await this.save();
    }

    return {
      deleted,
      id,
      section,
      totalEntries: after.length,
    };
  }

  async replace(
    section: string,
    id: string,
    content: string
  ): Promise<AgentMemoryReplaceResult> {
    assertMemorySection(section);
    assertContent(content);

    const entries = this.data.sections[section];
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return {
        id,
        replaced: false,
        section,
        totalEntries: entries.length,
      };
    }

    const existing = entries[index];
    if (existing === undefined) {
      throw new Error(`Memory entry '${id}' disappeared before replacement`);
    }
    const entry = { ...existing, content } satisfies AgentMemoryEntry;
    this.data.sections[section] = [
      ...entries.slice(0, index),
      entry,
      ...entries.slice(index + 1),
    ];
    await this.save();

    return {
      entry,
      id,
      replaced: true,
      section,
      totalEntries: this.data.sections[section].length,
    };
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    this.data.updatedAt = this.timestamp();

    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.filePath);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export function isAgentMemorySection(section: string): section is AgentMemorySection {
  return AGENT_MEMORY_SECTIONS.includes(section as AgentMemorySection);
}

function assertMemorySection(section: string): asserts section is AgentMemorySection {
  if (!isAgentMemorySection(section)) {
    throw new Error(
      `Unsupported memory section '${section}'. Use one of: ${AGENT_MEMORY_SECTIONS.join(", ")}`
    );
  }
}

function assertContent(content: string): void {
  if (content.length === 0) {
    throw new Error("Memory content must not be empty");
  }

  if (content.length > AGENT_MEMORY_MAX_ENTRY_CHARS) {
    throw new Error(
      `Memory content exceeds ${AGENT_MEMORY_MAX_ENTRY_CHARS} characters (${content.length})`
    );
  }
}

function emptyFile(timestamp: string): AgentMemoryFile {
  return {
    version: 1,
    updatedAt: timestamp,
    nextEntryId: 1,
    sections: emptySections(),
  };
}

function emptySections(): AgentMemorySections {
  return {
    objectives: [],
    journal: [],
    notes: [],
    strategy: [],
    landmarks: [],
    lessons: [],
  };
}

function normalizeFile(parsed: unknown, timestamp: string): AgentMemoryFile {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>).version !== 1
  ) {
    return emptyFile(timestamp);
  }

  const record = parsed as Record<string, unknown>;
  const normalizedSections = emptySections();
  const persistedSections = record.sections;
  let highestId = 0;

  if (typeof persistedSections === "object" && persistedSections !== null) {
    for (const section of AGENT_MEMORY_SECTIONS) {
      const rawEntries = (persistedSections as Record<string, unknown>)[section];
      if (!Array.isArray(rawEntries)) {
        continue;
      }

      const entries = rawEntries
        .map((entry) => normalizeEntry(entry))
        .filter((entry): entry is AgentMemoryEntry => entry !== null)
        .slice(-AGENT_MEMORY_MAX_ENTRIES_PER_SECTION);

      for (const entry of entries) {
        highestId = Math.max(highestId, parseEntryId(entry.id));
      }

      normalizedSections[section] = entries;
    }
  }

  const persistedNextEntryId = record.nextEntryId;
  const nextEntryId =
    typeof persistedNextEntryId === "number" &&
    Number.isInteger(persistedNextEntryId) &&
    persistedNextEntryId > highestId
      ? persistedNextEntryId
      : highestId + 1;

  return {
    version: 1,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : timestamp,
    nextEntryId,
    sections: normalizedSections,
  };
}

function normalizeEntry(entry: unknown): AgentMemoryEntry | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.content !== "string"
  ) {
    return null;
  }

  return {
    id: record.id,
    createdAt: record.createdAt,
    content: record.content.slice(0, AGENT_MEMORY_MAX_ENTRY_CHARS),
  };
}

function cloneFile(file: AgentMemoryFile): AgentMemoryFile {
  return {
    version: 1,
    updatedAt: file.updatedAt,
    nextEntryId: file.nextEntryId,
    sections: Object.fromEntries(
      AGENT_MEMORY_SECTIONS.map((section) => [
        section,
        [...file.sections[section]],
      ])
    ) as AgentMemorySections,
  };
}

function formatEntryId(id: number): string {
  return `mem-${id.toString().padStart(6, "0")}`;
}

function parseEntryId(id: string): number {
  const match = entryIdPattern.exec(id);
  return match === null ? 0 : Number.parseInt(match[1] ?? "0", 10);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
