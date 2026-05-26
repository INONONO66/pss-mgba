import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentMemoryStore } from "../../src/agent/AgentMemoryStore.js";
import { buildRunPaths } from "../../src/evidence/RunPaths.js";
import { startDevViewerServer } from "../../src/viewer/DevViewerServer.js";

const fakeSecret = `s${"k"}-viewer-secret-value`;

describe("DevViewerServer", () => {
  it("serves turn/global APIs and rejects removed legacy endpoints", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dev-viewer-"));
    const evidenceDir = path.join(root, "runs");
    const paths = buildRunPaths(evidenceDir, "viewer-run");
    await mkdir(paths.visionDir, { recursive: true });
    await mkdir(paths.turnsDir, { recursive: true });
    await mkdir(paths.globalDir, { recursive: true });
    await mkdir(paths.rawScreenshotsDir, { recursive: true });
    await writeFile(path.join(paths.visionDir, "000001-frame-11.jpeg"), Buffer.from([1, 2, 3]));
    await writeFile(path.join(paths.visionDir, "000002-frame-22.png"), Buffer.from([4, 5, 6]));
    await writeFile(path.join(paths.visionDir, "000003-frame-33.webp"), Buffer.from([7, 8, 9]));
    await writeFile(path.join(paths.rawScreenshotsDir, "000001.png"), Buffer.from([9, 8, 7]));
    await writeFile(path.join(paths.rawScreenshotsDir, "000002.png"), Buffer.from([6, 5, 4]));
    await writeFile(paths.turnFile(1), JSON.stringify({
      turn: 1,
      startedAt: "2026-05-24T00:00:00.000Z",
      finishedAt: "2026-05-24T00:00:01.000Z",
      frame: { before: 100, after: 120 },
      systemPrompt: "system",
      userPrompt: "Full game state summary",
      response: "response",
      parsedCommand: { type: "wait", frames: 1 },
      toolCalls: [{ toolCallId: "wait-1", toolName: "pokemon_wait", input: { frames: 1 }, output: { ok: true }, isGameAction: true }],
      gameState: { after: { wCurMap: 38, wYCoord: 3, wXCoord: 3 } },
    }));
    await writeFile(paths.summaryFile, JSON.stringify({
      runId: "viewer-run",
      status: "failed_timeout",
      counts: { turns: 1, screenshots: 1, errors: 0 },
      result: { status: "failed_timeout", totalSteps: 12, finalFrame: 345, detector: { status: "running" }, last20Actions: [{ step: 1, command: { type: "wait", frames: 1 }, result: { status: "success", reason: "waited" } }] }
    }));
    await writeFile(paths.mapMemoryFile, JSON.stringify({ version: 1, updatedAt: "2026-05-24T00:00:01.000Z", maps: { 38: { mapId: 38 } } }));
    await writeFile(paths.agentMemoryFile, JSON.stringify({ version: 1, updatedAt: "2026-05-24T00:00:02.000Z", sections: { objectives: [{ id: "mem-1", createdAt: "2026-05-24T00:00:02.000Z", content: "persisted objective" }], journal: [], notes: [{ id: "mem-2", createdAt: "2026-05-24T00:00:02.000Z", content: `secret ${fakeSecret}` }], strategy: [] } }));
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const viewer = await startDevViewerServer({
      evidenceDir,
      runId: "viewer-run",
      visionImageLimit: 2,
      port: 0,
      tempDir: path.join(root, "tmp"),
      client: {
        async screenshot(targetPath) {
          if (targetPath === undefined) { throw new Error("target path required"); }
          await writeFile(targetPath, pngBytes);
          return targetPath;
        }
      }
    });

    try {
      const turns = await fetchJson(`${viewer.url}/api/turns?limit=20`);
      expect(turns).toMatchObject({ runId: "viewer-run", count: 1, turns: [{ turn: 1, parsedCommand: { type: "wait", frames: 1 }, toolCalls: [{ toolName: "대기" }] }] });
      expect(JSON.stringify(turns)).not.toContain("pokemon_wait");

      const summary = await fetchJson(`${viewer.url}/api/global/run-summary`);
      expect(summary).toMatchObject({ runId: "viewer-run", status: "failed_timeout", totalSteps: 12, finalFrame: 345, lastAction: { command: { type: "wait", frames: 1 }, rationale: "waited" } });

      const gameState = await fetchJson(`${viewer.url}/api/game-state?limit=5`);
      expect(gameState).toMatchObject({ runId: "viewer-run", count: 1, latest: { state: { wCurMap: 38, wYCoord: 3, wXCoord: 3 } } });

      const mapMemory = await fetchJson(`${viewer.url}/api/global/map-memory`);
      expect(mapMemory).toMatchObject({ runId: "viewer-run", version: 1, maps: { 38: { mapId: 38 } } });

      const agentMemory = await fetchJson(`${viewer.url}/api/global/agent-memory`);
      expect(agentMemory).toMatchObject({ runId: "viewer-run", updatedAt: "2026-05-24T00:00:02.000Z", sections: { objectives: [{ content: "persisted objective" }], notes: [{ content: "secret [REDACTED]" }] } });
      expect(JSON.stringify(agentMemory)).not.toContain(fakeSecret);

      expect((await fetch(`${viewer.url}/api/${"events"}?limit=2`)).status).toBe(404);
      expect((await fetch(`${viewer.url}/api/${"run-summary"}`)).status).toBe(404);
      expect((await fetch(`${viewer.url}/api/llm-${"conversations"}`)).status).toBe(404);
      expect((await fetch(`${viewer.url}/api/agent-memory`)).status).toBe(404);

      const rawScreenshots = await fetchJson(`${viewer.url}/api/screenshots?limit=12`);
      const screenshots = Array.isArray(rawScreenshots.screenshots) ? rawScreenshots.screenshots : [];
      expect(screenshots.map((screenshot) => isRecord(screenshot) ? screenshot.fileName : undefined)).toEqual(["000002.png", "000001.png"]);
    } finally {
      await viewer.close();
    }
  });

  it("redacts live global agent-memory API snapshots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dev-viewer-live-memory-"));
    const evidenceDir = path.join(root, "runs");
    const paths = buildRunPaths(evidenceDir, "viewer-run");
    await mkdir(paths.globalDir, { recursive: true });
    const memoryStore = new AgentMemoryStore({ filePath: paths.agentMemoryFile, now: () => new Date("2026-05-24T00:00:02.000Z") });
    await memoryStore.load();
    await memoryStore.write("notes", `live ${fakeSecret}`);

    const viewer = await startDevViewerServer({
      evidenceDir,
      runId: "viewer-run",
      port: 0,
      tempDir: path.join(root, "tmp"),
      agentMemoryStore: memoryStore,
      client: { async screenshot(targetPath) { if (targetPath === undefined) { throw new Error("target path required"); } await writeFile(targetPath, Buffer.from([1])); return targetPath; } }
    });

    try {
      const agentMemory = await fetchJson(`${viewer.url}/api/global/agent-memory`);
      expect(agentMemory).toMatchObject({ sections: { notes: [{ content: "live [REDACTED]" }] } });
      expect(JSON.stringify(agentMemory)).not.toContain(fakeSecret);
    } finally {
      await viewer.close();
    }
  });

  it("ignores symlinked turn artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dev-viewer-symlink-"));
    const evidenceDir = path.join(root, "runs");
    const paths = buildRunPaths(evidenceDir, "viewer-run");
    await mkdir(paths.turnsDir, { recursive: true });
    await writeFile(paths.turnFile(1), JSON.stringify({ turn: 1, response: "real" }));
    const outsideFile = path.join(root, "outside.json");
    await writeFile(outsideFile, JSON.stringify({ turn: 2, response: "symlink-leak" }));
    await symlink(outsideFile, paths.turnFile(2));

    const viewer = await startDevViewerServer({
      evidenceDir,
      runId: "viewer-run",
      port: 0,
      tempDir: path.join(root, "tmp"),
      client: { async screenshot(targetPath) { if (targetPath === undefined) { throw new Error("target path required"); } await writeFile(targetPath, Buffer.from([1])); return targetPath; } }
    });

    try {
      const turns = await fetchJson(`${viewer.url}/api/turns`);
      expect(turns).toMatchObject({ count: 1, turns: [{ response: "real" }] });
      expect(JSON.stringify(turns)).not.toContain("symlink-leak");
    } finally {
      await viewer.close();
    }
  });

  it("does not follow symlinked global JSON or direct image artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dev-viewer-global-symlink-"));
    const evidenceDir = path.join(root, "runs");
    const paths = buildRunPaths(evidenceDir, "viewer-run");
    await mkdir(paths.globalDir, { recursive: true });
    await mkdir(paths.visionDir, { recursive: true });
    await mkdir(paths.rawScreenshotsDir, { recursive: true });
    const leakedJson = path.join(root, "leaked.json");
    const leakedPng = path.join(root, "leaked.png");
    await writeFile(leakedJson, JSON.stringify({ runId: "leaked", status: "completed", secret: "symlink-leak" }));
    await writeFile(leakedPng, Buffer.from("symlink-leak"));
    await symlink(leakedJson, paths.summaryFile);
    await symlink(leakedJson, paths.mapMemoryFile);
    await symlink(leakedPng, path.join(paths.visionDir, "000004-frame-44.png"));
    await symlink(leakedPng, path.join(paths.rawScreenshotsDir, "000003.png"));

    const viewer = await startDevViewerServer({
      evidenceDir,
      runId: "viewer-run",
      port: 0,
      tempDir: path.join(root, "tmp"),
      client: { async screenshot(targetPath) { if (targetPath === undefined) { throw new Error("target path required"); } await writeFile(targetPath, Buffer.from([1])); return targetPath; } }
    });

    try {
      const summary = await fetchJson(`${viewer.url}/api/global/run-summary`);
      expect(summary).toMatchObject({ runId: "viewer-run", status: "running" });
      const mapMemory = await fetchJson(`${viewer.url}/api/global/map-memory`);
      expect(mapMemory).toMatchObject({ runId: "viewer-run", version: 1, maps: {} });
      expect(JSON.stringify({ summary, mapMemory })).not.toContain("symlink-leak");
      expect((await fetch(`${viewer.url}/vision/000004-frame-44.png`)).status).toBe(404);
      expect((await fetch(`${viewer.url}/raw-screenshots/000003.png`)).status).toBe(404);
    } finally {
      await viewer.close();
    }
  });

});

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json() as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
