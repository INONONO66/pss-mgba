import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EvidenceRecorder, redactSecrets } from "../../src/evidence/EvidenceRecorder.js";
import { buildRunPaths } from "../../src/evidence/RunPaths.js";

const fakeSecret = `s${"k"}-test-secret-value`;

describe("EvidenceRecorder", () => {
  it("creates the turn/global evidence layout without legacy event or LLM directories", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "evidence-layout-"));
    const recorder = new EvidenceRecorder({ evidenceDir, runId: "run-1", now: fixedNow });

    await recorder.startRun({ provider: "heuristic", OPENAI_API_KEY: fakeSecret });
    const turnFile = await recorder.recordTurn({
      turn: 1,
      startedAt: fixedNow().toISOString(),
      finishedAt: fixedNow().toISOString(),
      systemPrompt: `system ${fakeSecret}`,
      userPrompt: "user",
      response: "response",
      toolCalls: [{ toolName: "pokemon_wait", input: { frames: 1 }, output: { ok: true }, isGameAction: true }],
    });
    await recorder.recordError(new Error(`bad token ${fakeSecret}`));
    const summary = await recorder.finishRun("completed", { checkpoint: "starter acquired" });

    const paths = buildRunPaths(evidenceDir, "run-1");
    await expect(stat(paths.configFile)).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(stat(paths.globalDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(paths.turnsDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(paths.rawScreenshotsDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(paths.visionDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(paths.errorsDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });

    expect(turnFile).toBe(paths.turnFile(1));
    expect(summary.status).toBe("completed");
    expect(summary.counts).toEqual({ turns: 1, screenshots: 0, errors: 1 });
    await expect(stat(path.join(paths.runDir, "events.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(paths.runDir, "llm-conversations"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(paths.runDir, "states"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("redacts secret-like config, turn, error, and summary values before writing", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "evidence-redaction-"));
    const recorder = new EvidenceRecorder({ evidenceDir, runId: "run-secret", now: fixedNow });

    await recorder.startRun({ nested: { apiKey: fakeSecret }, note: `inline ${fakeSecret}` });
    await recorder.recordTurn({ turn: 1, startedAt: fixedNow().toISOString(), finishedAt: fixedNow().toISOString(), response: `uses ${fakeSecret}` });
    await recorder.recordError({ message: `failed with ${fakeSecret}`, accessToken: "token-value" });
    await recorder.finishRun("failed_mgba", { reason: `contains ${fakeSecret}` });

    const paths = buildRunPaths(evidenceDir, "run-secret");
    const written = await Promise.all([
      readFile(paths.configFile, "utf8"),
      readFile(paths.turnFile(1), "utf8"),
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
