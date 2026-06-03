import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PersistentMemory } from "../../src/supervisor/PersistentMemory.js";

const TMP_BASE = "/var/folders/70/44j59lmn1x95z003s9fg4qlm0000gn/T/opencode";

function uniqueDir(prefix: string): string {
  return path.join(TMP_BASE, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function makeEntry(overrides: Partial<Parameters<PersistentMemory["record"]>[0]> = {}) {
  return {
    runId: "run-001",
    kind: "mistake_resolved" as const,
    mapId: 38,
    mapName: "Oaks Lab",
    badges: 0,
    situation: "Stuck looping between tiles (6,2)-(8,2)",
    resolution: "Resolved after 8 turns. Moved to Pallet Town.",
    tags: ["map:38", "goal:explore"],
    ...overrides,
  };
}

describe("PersistentMemory", () => {
  it("starts empty when file does not exist", async () => {
    const dir = uniqueDir("pm-empty");
    await mkdir(dir, { recursive: true });
    const pm = new PersistentMemory(path.join(dir, "persistent-memory.json"));

    await pm.load();

    expect(pm.size).toBe(0);
    expect(pm.entries).toEqual([]);
  });

  it("records an entry and assigns id + createdAt", async () => {
    const dir = uniqueDir("pm-record");
    await mkdir(dir, { recursive: true });
    const pm = new PersistentMemory(path.join(dir, "persistent-memory.json"));

    const entry = await pm.record(makeEntry());

    expect(entry.id).toBe("pm-000001");
    expect(typeof entry.createdAt).toBe("string");
    expect(entry.situation).toBe("Stuck looping between tiles (6,2)-(8,2)");
    expect(pm.size).toBe(1);
  });

  it("increments entry ids", async () => {
    const dir = uniqueDir("pm-ids");
    await mkdir(dir, { recursive: true });
    const pm = new PersistentMemory(path.join(dir, "persistent-memory.json"));

    const first = await pm.record(makeEntry());
    const second = await pm.record(makeEntry({ mapId: 1, mapName: "Pallet Town" }));

    expect(first.id).toBe("pm-000001");
    expect(second.id).toBe("pm-000002");
  });

  it("persists and reloads across instances", async () => {
    const dir = uniqueDir("pm-persist");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "persistent-memory.json");

    const pm1 = new PersistentMemory(filePath);
    await pm1.record(makeEntry());
    await pm1.record(makeEntry({ mapId: 1, mapName: "Route 1", badges: 1 }));

    const pm2 = new PersistentMemory(filePath);
    await pm2.load();

    expect(pm2.size).toBe(2);
    expect(pm2.entries[0]?.mapName).toBe("Oaks Lab");
    expect(pm2.entries[1]?.mapName).toBe("Route 1");
  });

  it("query returns entries matching mapId", async () => {
    const dir = uniqueDir("pm-query-map");
    await mkdir(dir, { recursive: true });
    const pm = new PersistentMemory(path.join(dir, "persistent-memory.json"));

    await pm.record(makeEntry({ mapId: 38, mapName: "Oaks Lab" }));
    await pm.record(makeEntry({ mapId: 1, mapName: "Route 1" }));
    await pm.record(makeEntry({ mapId: 38, mapName: "Oaks Lab", situation: "Different stuck" }));

    const results = pm.query({ mapId: 38 });

    expect(results.length).toBe(3);
    const mapIds = results.map((e) => e.mapId);
    expect(mapIds[0]).toBe(38);
    expect(mapIds[1]).toBe(38);
  });

  it("query filters by badge range", async () => {
    const dir = uniqueDir("pm-query-badges");
    await mkdir(dir, { recursive: true });
    const pm = new PersistentMemory(path.join(dir, "persistent-memory.json"));

    await pm.record(makeEntry({ badges: 0 }));
    await pm.record(makeEntry({ badges: 1 }));
    await pm.record(makeEntry({ badges: 5 }));

    const results = pm.query({ badges: 1, badgeRange: 1 });

    expect(results.length).toBe(2);
    const badges = results.map((e) => e.badges);
    expect(badges).not.toContain(5);
  });

  it("query respects limit", async () => {
    const dir = uniqueDir("pm-query-limit");
    await mkdir(dir, { recursive: true });
    const pm = new PersistentMemory(path.join(dir, "persistent-memory.json"));

    for (let i = 0; i < 10; i++) {
      await pm.record(makeEntry({ situation: `stuck-${i}` }));
    }

    const results = pm.query({ limit: 3 });

    expect(results.length).toBe(3);
  });

  it("query returns empty array when no matches", async () => {
    const dir = uniqueDir("pm-query-none");
    await mkdir(dir, { recursive: true });
    const pm = new PersistentMemory(path.join(dir, "persistent-memory.json"));

    await pm.record(makeEntry({ badges: 7 }));

    const results = pm.query({ badges: 0, badgeRange: 0 });

    expect(results).toEqual([]);
  });

  it("evicts oldest entries beyond max capacity", async () => {
    const dir = uniqueDir("pm-evict");
    await mkdir(dir, { recursive: true });
    const pm = new PersistentMemory(path.join(dir, "persistent-memory.json"));

    for (let i = 0; i < 510; i++) {
      await pm.record(makeEntry({ situation: `stuck-${i}` }));
    }

    expect(pm.size).toBe(500);
    expect(pm.entries[0]?.situation).toBe("stuck-10");
  });

  it("snapshot returns a copy of the data", async () => {
    const dir = uniqueDir("pm-snapshot");
    await mkdir(dir, { recursive: true });
    const pm = new PersistentMemory(path.join(dir, "persistent-memory.json"));

    await pm.record(makeEntry());
    const snap = pm.snapshot();

    expect(snap.version).toBe(1);
    expect(snap.entries.length).toBe(1);
    expect(typeof snap.updatedAt).toBe("string");
  });

  it("handles corrupt file gracefully", async () => {
    const dir = uniqueDir("pm-corrupt");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "persistent-memory.json");

    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, "not valid json {{}", "utf8");

    const pm = new PersistentMemory(filePath);
    await pm.load();

    expect(pm.size).toBe(0);
  });

  it("handles wrong version gracefully", async () => {
    const dir = uniqueDir("pm-version");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "persistent-memory.json");

    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, JSON.stringify({ version: 99, entries: [] }), "utf8");

    const pm = new PersistentMemory(filePath);
    await pm.load();

    expect(pm.size).toBe(0);
  });

  it("query sorts by tag relevance", async () => {
    const dir = uniqueDir("pm-tags");
    await mkdir(dir, { recursive: true });
    const pm = new PersistentMemory(path.join(dir, "persistent-memory.json"));

    await pm.record(makeEntry({ tags: ["map:38"] }));
    await pm.record(makeEntry({ tags: ["map:38", "goal:explore", "adviser_hint"] }));
    await pm.record(makeEntry({ tags: ["goal:explore"] }));

    const results = pm.query({ tags: ["map:38", "goal:explore"], limit: 3 });

    expect(results[0]?.tags).toContain("map:38");
    expect(results[0]?.tags).toContain("goal:explore");
  });
});
