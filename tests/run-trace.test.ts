import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOptimizedFreshRunTrace,
  createRunTrace,
  EXPERIMENT_MODES,
  SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP,
  updateRunTraceMetadata,
  validateRunExperimentMetadata,
} from "../src/run-trace";

const originalCwd = cwd();

afterEach(() => {
  chdir(originalCwd);
});

describe("createRunTrace", () => {
  it("allocates stable run iterations and writes trace metadata", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pss-mgba-trace-"));
    chdir(tempDir);

    const first = await createRunTrace(new Date("2026-05-24T00:00:00.000Z"));
    const second = await createRunTrace(new Date("2026-05-24T00:00:01.000Z"));

    expect(first.iteration).toBe(1);
    expect(first.runId).toBe("00001-2026-05-24T00-00-00-000Z");
    expect(first.metricsDir).toBe(
      ".pss-mgba/traces/runs/00001-2026-05-24T00-00-00-000Z"
    );
    expect(second.iteration).toBe(2);

    const iterationLog = await readFile(
      ".pss-mgba/traces/iterations.jsonl",
      "utf8"
    );
    expect(iterationLog.trim().split("\n")).toHaveLength(2);
    expect(
      JSON.parse(iterationLog.trim().split("\n")[0] ?? "{}")
    ).toMatchObject({
      iteration: 1,
      runId: first.runId,
      type: "run-start",
    });
  });

  it("serializes each valid experiment mode and all experiment metadata fields", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pss-mgba-trace-modes-"));
    chdir(tempDir);

    for (const [index, mode] of EXPERIMENT_MODES.entries()) {
      const trace = await createRunTrace(new Date(2026, 4, 24, 0, 0, index), {
        experimentId: `experiment-${mode}`,
        milestone: "route-1",
        milestoneCurrent: "player-control-reached",
        milestoneFurthest: "first-map-transition",
        mode,
        objective: "Reach the next navigation proof point.",
        ramReadStatus: "not-attempted",
        runBudget: "300s",
        saveStateStatus: "supported",
        saveStatePath: `.pss-mgba/states/${mode}.ss0`,
        stateSource: mode === "fresh" ? "new-game" : "save-state",
        stuckEvents: index,
        supervisorEnabled: mode !== "fresh",
        supervisorInterventions: index + 1,
      });

      const saved = JSON.parse(
        await readFile(join(trace.metricsDir, "run.json"), "utf8")
      );
      expect(saved).toMatchObject({
        experimentId: `experiment-${mode}`,
        milestone: "route-1",
        milestoneCurrent: "player-control-reached",
        milestoneFurthest: "first-map-transition",
        mode,
        objective: "Reach the next navigation proof point.",
        ramReadStatus: "not-attempted",
        runBudget: "300s",
        saveStateStatus: "supported",
        saveStatePath: `.pss-mgba/states/${mode}.ss0`,
        stateSource: mode === "fresh" ? "new-game" : "save-state",
        stuckEvents: index,
        supervisorEnabled: mode !== "fresh",
        supervisorInterventions: index + 1,
      });
    }
  });

  it("creates default metadata for the optimized fresh live harness run", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pss-mgba-trace-default-"));
    chdir(tempDir);

    const trace = await createOptimizedFreshRunTrace(
      new Date("2026-05-24T00:00:00.000Z")
    );

    const saved = JSON.parse(
      await readFile(join(trace.metricsDir, "run.json"), "utf8")
    );
    expect(saved).toMatchObject({
      experimentId: "combined-optimized",
      mode: "fresh",
      objective:
        "Continue playing the already-loaded Pokemon game autonomously without reset, reload, or restart.",
      runBudget: "300s",
      stateSource: "already-running-mgba-http",
      stuckEvents: 0,
      supervisorEnabled: true,
      supervisorInterventions: 0,
    });
  });

  it("rejects invalid experiment modes at runtime", () => {
    expect(() =>
      validateRunExperimentMetadata({
        mode: "invalid-mode",
      } as never)
    ).toThrow("Invalid experiment mode: invalid-mode");
  });

  it("updates runtime metadata in the run trace without reallocating a run", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pss-mgba-trace-update-"));
    chdir(tempDir);

    const trace = await createRunTrace(new Date("2026-05-24T00:00:00.000Z"));
    const updated = await updateRunTraceMetadata(trace, {
      milestone: "first-battle-detected",
      milestoneCurrent: "first-battle-detected",
      milestoneFurthest: "first-battle-detected",
      stuckEvents: 2,
      supervisorInterventions: 5,
    });

    expect(updated.runId).toBe(trace.runId);
    expect(updated.milestoneFurthest).toBe("first-battle-detected");
    expect(
      JSON.parse(await readFile(join(trace.metricsDir, "run.json"), "utf8"))
    ).toMatchObject({
      milestone: "first-battle-detected",
      milestoneCurrent: "first-battle-detected",
      milestoneFurthest: "first-battle-detected",
      runId: trace.runId,
      stuckEvents: 2,
      supervisorInterventions: 5,
    });
  });

  it("records unsupported save-state status without inventing a save-state path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pss-mgba-trace-save-state-"));
    chdir(tempDir);

    const trace = await createRunTrace(new Date("2026-05-24T00:00:00.000Z"), {
      mode: "recovery",
      saveStateStatus: SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP,
      stateSource: "save-state-unsupported",
    });

    const saved = JSON.parse(
      await readFile(join(trace.metricsDir, "run.json"), "utf8")
    );
    expect(saved).toMatchObject({
      mode: "recovery",
      saveStateStatus: SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP,
      stateSource: "save-state-unsupported",
    });
    expect(saved).not.toHaveProperty("saveStatePath");
  });

  it("rejects fake save-state paths when current mGBA-http does not support save-states", () => {
    expect(() =>
      validateRunExperimentMetadata({
        mode: "deterministic-replay",
        saveStatePath: ".pss-mgba/states/fake.ss0",
        saveStateStatus: SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP,
      })
    ).toThrow("saveStatePath must be omitted");
  });
});
