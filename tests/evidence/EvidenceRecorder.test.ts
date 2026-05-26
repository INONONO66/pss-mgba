import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EvidenceRecorder, redactSecrets, type TurnLog } from "../../src/evidence/EvidenceRecorder.js";
import { buildRunPaths } from "../../src/evidence/RunPaths.js";

const fakeSecret = `s${"k"}-test-secret-value`;

describe("EvidenceRecorder", () => {
  it("creates the turn/global evidence layout without legacy event or LLM directories", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "evidence-layout-"));
    const recorder = new EvidenceRecorder({ evidenceDir, runId: "run-1", now: fixedNow });

    await recorder.startRun({ provider: "heuristic", OPENAI_API_KEY: fakeSecret });
    const turnFile = await recorder.recordTurn(completeTurnLog({
      runId: "run-1",
      systemPrompt: `system ${fakeSecret}`,
      userPrompt: "user",
      response: "response",
      toolCalls: [{ toolCallId: "call-1", toolName: "pokemon_wait", input: { frames: 1 }, output: { ok: true }, isGameAction: true }],
      timeline: [{ sequence: 1, timestamp: fixedNow().toISOString(), type: "assistant-text", text: "response" }],
    }));
    await recorder.recordError(new Error(`bad token ${fakeSecret}`));
    const summary = await recorder.finishRun("completed", { checkpoint: "starter acquired" });

    const paths = buildRunPaths(evidenceDir, "run-1");
    expect((await stat(paths.configFile)).isFile()).toBe(true);
    expect((await stat(paths.globalDir)).isDirectory()).toBe(true);
    expect((await stat(paths.turnsDir)).isDirectory()).toBe(true);
    expect((await stat(paths.rawScreenshotsDir)).isDirectory()).toBe(true);
    expect((await stat(paths.visionDir)).isDirectory()).toBe(true);
    expect((await stat(paths.errorsDir)).isDirectory()).toBe(true);

    expect(turnFile).toBe(paths.turnFile(1));
    expect(summary.status).toBe("completed");
    expect(summary.counts).toEqual({ turns: 1, screenshots: 0, errors: 1 });
    await expect(stat(path.join(paths.runDir, `events.${"jsonl"}`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(paths.runDir, `llm-${"conversations"}`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(paths.runDir, "states"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("redacts secret-like config, turn, error, and summary values before writing", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "evidence-redaction-"));
    const recorder = new EvidenceRecorder({ evidenceDir, runId: "run-secret", now: fixedNow });

    await recorder.startRun({ nested: { apiKey: fakeSecret }, note: `inline ${fakeSecret}` });
    await recorder.recordTurn(completeTurnLog({
      runId: "run-secret",
      response: `uses ${fakeSecret}`,
      timeline: [{ sequence: 1, timestamp: fixedNow().toISOString(), type: "assistant-text", text: `uses ${fakeSecret}` }],
    }));
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

  it("rejects unsafe run ids before creating paths", async () => {
    expect(() => buildRunPaths("runs", "../escape")).toThrow(/safe single path segment/);
    expect(() => buildRunPaths("runs", "bad/id")).toThrow(/safe single path segment/);
    expect(() => buildRunPaths("runs", "safe-run_1.2")).not.toThrow();
  });

  it("rejects incomplete turn logs before writing", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "evidence-invalid-turn-"));
    const recorder = new EvidenceRecorder({ evidenceDir, runId: "invalid-turn", now: fixedNow });

    await recorder.startRun({ provider: "test" });

    await expect(recorder.recordTurn({ turn: 1 } as never)).rejects.toThrow(/Turn log is missing required integrated fields/);
  });

  it("rejects turn logs with mismatched run metadata or malformed timeline", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "evidence-bad-timeline-"));
    const recorder = new EvidenceRecorder({ evidenceDir, runId: "timeline-run", now: fixedNow });
    await recorder.startRun({ provider: "test" });

    await expect(recorder.recordTurn(completeTurnLog({ runId: "other-run" }))).rejects.toThrow(/Turn log is missing required integrated fields/);
    await expect(recorder.recordTurn(completeTurnLog({ runId: "timeline-run", timeline: [{ type: "tool-call" } as never] }))).rejects.toThrow(/Turn log is missing required integrated fields/);
  });
});

function completeTurnLog(overrides: Partial<TurnLog> & { runId?: string } = {}): TurnLog {
  const runId = typeof overrides.runId === "string" ? overrides.runId : "run-1";
  const base: TurnLog = {
    version: 1,
    turn: 1,
    run: { runId, runner: "test", objective: "test objective", sessionKey: "test-session", maxTurns: 1, startedAt: fixedNow().toISOString(), status: "running" },
    startedAt: fixedNow().toISOString(),
    finishedAt: fixedNow().toISOString(),
    frame: { before: 1, after: 2 },
    systemPrompt: "system",
    userPrompt: "user",
    reasoning: "",
    response: "response",
    timeline: [],
    toolCalls: [],
    gameState: { before: { mode: "overworld" }, after: { mode: "overworld" } },
    agentMemory: { sections: { objectives: [], journal: [], notes: [], strategy: [] } },
    mapAscii: "map ascii",
    mapGraph: "map graph",
    detector: { status: "running", checkpoints: {} },
    history: [],
  };
  const { runId: _runId, ...rest } = overrides;
  return { ...base, ...rest } satisfies TurnLog;
}

function fixedNow(): Date {
  return new Date("2026-05-22T00:00:00.000Z");
}
