import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EvidenceRecorder, redactSecrets } from "../../src/evidence/EvidenceRecorder.js";
import { buildRunPaths } from "../../src/evidence/RunPaths.js";

const fakeSecret = `s${"k"}-test-secret-value`;

describe("EvidenceRecorder", () => {
  it("creates the planned evidence layout with JSONL events", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "evidence-layout-"));
    const recorder = new EvidenceRecorder({ evidenceDir, runId: "run-1", now: fixedNow });

    await recorder.startRun({ provider: "heuristic", OPENAI_API_KEY: fakeSecret });
    const stateFile = await recorder.recordState({ map: "Pallet", coords: { x: 1, y: 2 } });
    await recorder.recordDecision({ reason: "current state", action: "A" });
    await recorder.recordAction({ type: "press", button: "A" });
    const screenshotFile = await recorder.recordScreenshot({ path: "/tmp/frame.png", frame: 12, step: 1 });
    const errorFile = await recorder.recordError(new Error(`bad token ${fakeSecret}`));
    const summary = await recorder.finishRun("completed", { checkpoint: "starter acquired" });

    const paths = buildRunPaths(evidenceDir, "run-1");
    await expect(stat(paths.configFile)).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(stat(paths.eventsFile)).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(stat(paths.summaryFile)).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(stat(paths.statesDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(paths.screenshotsDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(paths.rawScreenshotsDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(paths.visionDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(paths.errorsDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });

    expect(stateFile).toBe(paths.stateFile(1));
    expect(screenshotFile).toBe(paths.screenshotFile(1));
    expect(errorFile).toBe(paths.errorFile(1));
    expect(summary.status).toBe("completed");
    expect(summary.counts).toEqual({ states: 1, decisions: 1, actions: 1, screenshots: 1, errors: 1, events: 7 });

    const events = await readJsonLines(paths.eventsFile);
    expect(events).toHaveLength(7);
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "state",
      "decision",
      "action",
      "screenshot",
      "error",
      "run_finished"
    ]);
  });

  it("redacts secret-like config, error, and event values before writing", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "evidence-redaction-"));
    const recorder = new EvidenceRecorder({ evidenceDir, runId: "run-secret", now: fixedNow });

    await recorder.startRun({ nested: { apiKey: fakeSecret }, note: `inline ${fakeSecret}` });
    await recorder.recordDecision({ modelOutput: `uses ${fakeSecret}` });
    await recorder.recordError({ message: `failed with ${fakeSecret}`, accessToken: "token-value" });
    await recorder.finishRun("failed_mgba", { reason: `contains ${fakeSecret}` });

    const paths = buildRunPaths(evidenceDir, "run-secret");
    const written = await Promise.all([
      readFile(paths.configFile, "utf8"),
      readFile(paths.eventsFile, "utf8"),
      readFile(paths.errorFile(1), "utf8"),
      readFile(paths.summaryFile, "utf8")
    ]);
    const joined = written.join("\n");

    expect(joined).not.toContain(fakeSecret);
    expect(joined).not.toContain("token-value");
    expect(joined).toContain("[REDACTED]");
  });

  it("redacts standalone values without requiring Task 2 redaction", () => {
    expect(redactSecrets({ password: "p", value: `before ${fakeSecret} after` })).toEqual({
      password: "[REDACTED]",
      value: "before [REDACTED] after"
    });
  });
});

function fixedNow(): Date {
  return new Date("2026-05-22T00:00:00.000Z");
}

async function readJsonLines(file: string): Promise<Array<{ type: string }>> {
  const content = await readFile(file, "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string });
}
