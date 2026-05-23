import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { createRunTrace } from "../src/run-trace";

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
});
