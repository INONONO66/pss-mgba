import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KnowledgeBase } from "../../src/supervisor/index.js";

const TMP_BASE = "/var/folders/70/44j59lmn1x95z003s9fg4qlm0000gn/T/opencode";

function uniqueDir(prefix: string): string {
  return path.join(TMP_BASE, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

interface EntryOverrides {
  mapId?: number;
  badges?: number;
  outcome?: "helped" | "unhelpful" | "unknown";
}

function makeEntry(key: string, advice: string, overrides: EntryOverrides = {}) {
  return {
    situationKey: key,
    advice,
    ...overrides,
  };
}

describe("KnowledgeBase", () => {
  it("creates empty KB when file does not exist", async () => {
    const dir = uniqueDir("kb-missing");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "global", "adviser-knowledge.json");
    const kb = new KnowledgeBase(filePath);

    await kb.load();

    expect(kb.size).toBe(0);
    expect(kb.entries).toEqual([]);
  });

  it("records and retrieves entry by situation key", async () => {
    const dir = uniqueDir("kb-record");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "global", "adviser-knowledge.json");
    const kb = new KnowledgeBase(filePath);

    kb.record(makeEntry("map:38:badges:0:stuck:action_loop", "Try moving away from the wall first.", { mapId: 38, badges: 0 }));

    const entry = kb.lookup("map:38:badges:0:stuck:action_loop");

    expect(entry).toMatchObject({
      situationKey: "map:38:badges:0:stuck:action_loop",
      advice: "Try moving away from the wall first.",
      mapId: 38,
      badges: 0,
      outcome: undefined,
      usedCount: 1,
    });
    expect(typeof entry?.createdAt).toBe("string");
  });

  it("lookup returns undefined for unknown key", async () => {
    const dir = uniqueDir("kb-unknown");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "global", "adviser-knowledge.json");
    const kb = new KnowledgeBase(filePath);

    expect(kb.lookup("nonexistent")).toBeUndefined();
  });

  it("lookup increments usedCount", async () => {
    const dir = uniqueDir("kb-lookup-count");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "global", "adviser-knowledge.json");
    const kb = new KnowledgeBase(filePath);

    kb.record(makeEntry("map:1:badges:0:stuck:menu", "Try pressing B.", { mapId: 1, badges: 0 }));

    kb.lookup("map:1:badges:0:stuck:menu");
    const entry = kb.lookup("map:1:badges:0:stuck:menu");

    expect(entry?.usedCount).toBe(2);
  });

  it("round-trips through save and load", async () => {
    const dir = uniqueDir("kb-roundtrip");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "global", "adviser-knowledge.json");
    const kb = new KnowledgeBase(filePath);

    kb.record(makeEntry("map:2:badges:1:stuck:dialog", "Wait for the text box to finish.", { mapId: 2, badges: 1 }));
    kb.record(makeEntry("map:3:badges:2:stuck:pathing", "Face a different direction and move one tile.", { mapId: 3, badges: 2, outcome: "helped" }));
    kb.lookup("map:3:badges:2:stuck:pathing");

    await kb.save();

    const loaded = new KnowledgeBase(filePath);
    await loaded.load();

    expect(loaded.size).toBe(2);
    expect(loaded.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          situationKey: "map:2:badges:1:stuck:dialog",
          advice: "Wait for the text box to finish.",
          mapId: 2,
          badges: 1,
          usedCount: 0,
        }),
        expect.objectContaining({
          situationKey: "map:3:badges:2:stuck:pathing",
          advice: "Face a different direction and move one tile.",
          mapId: 3,
          badges: 2,
          outcome: "helped",
          usedCount: 1,
        }),
      ]),
    );
  });

  it("atomic write uses temp file", async () => {
    const dir = uniqueDir("kb-atomic");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "global", "adviser-knowledge.json");
    const tmpPath = `${filePath}.tmp`;
    const kb = new KnowledgeBase(filePath);

    kb.record(makeEntry("map:10:badges:3:stuck:loop", "Try a different interaction target.", { mapId: 10, badges: 3 }));
    await kb.save();

    await expect(stat(filePath)).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(access(tmpPath)).rejects.toThrow();
  });

  it("evicts least-used entries when exceeding max", async () => {
    const dir = uniqueDir("kb-evict");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "global", "adviser-knowledge.json");
    const kb = new KnowledgeBase(filePath);

    for (let i = 0; i < 201; i += 1) {
      kb.record(makeEntry(`key-${i}`, `advice-${i}`, { mapId: i, badges: i % 8 }));
    }

    for (let i = 0; i < 10; i += 1) {
      kb.lookup("key-200");
    }

    kb.record(makeEntry("key-201", "advice-201", { mapId: 201, badges: 1 }));

    expect(kb.size).toBeLessThanOrEqual(200);
    expect(kb.lookup("key-200")).toBeDefined();
    expect(kb.lookup("key-0")).toBeUndefined();
  });

  it("markOutcome updates existing entry", async () => {
    const dir = uniqueDir("kb-outcome");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "global", "adviser-knowledge.json");
    const kb = new KnowledgeBase(filePath);

    kb.record(makeEntry("map:4:badges:0:stuck:dialog", "Press A once the prompt finishes.", { mapId: 4, badges: 0 }));
    kb.markOutcome("map:4:badges:0:stuck:dialog", "helped");

    expect(kb.lookup("map:4:badges:0:stuck:dialog")?.outcome).toBe("helped");
  });
});
