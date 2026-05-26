import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanForSecrets } from "../../scripts/check-no-secrets.js";
import { EvidenceRecorder } from "../../src/evidence/EvidenceRecorder.js";
import { redactSecrets } from "../../src/evidence/redaction.js";
import { buildRunPaths } from "../../src/evidence/RunPaths.js";

const fakeSecret = `s${"k"}-test-should-fail`;

describe("secret redaction and scanning", () => {
  it("flags fake OpenAI-style tokens in temporary text fixtures", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "secret-scan-"));
    await writeFixture(rootDir, "fixture.ts", `const token = "${fakeSecret}";\n`);
    await writeFixture(rootDir, "placeholder.md", "Use sk-REPLACE_ME as documentation only.\n");

    const result = await scanForSecrets({ rootDir });

    expect(result.findings).toEqual([
      {
        file: "fixture.ts",
        line: 1,
        column: 16,
        match: fakeSecret
      }
    ]);
  });

  it("keeps shared redaction output free of secret values", () => {
    const redacted = redactSecrets({ OPENAI_API_KEY: fakeSecret, nested: `value ${fakeSecret}` });

    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain(fakeSecret);
  });

  it("does not write secret values into generated evidence files", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "secret-evidence-"));
    const recorder = new EvidenceRecorder({ evidenceDir, runId: "redaction-check", now: fixedNow });

    await recorder.startRun({ OPENAI_API_KEY: fakeSecret });
    await recorder.recordTurn({ turn: 1, startedAt: fixedNow().toISOString(), finishedAt: fixedNow().toISOString(), response: `token ${fakeSecret}` });
    await recorder.recordError(new Error(`failed with ${fakeSecret}`));
    await recorder.finishRun("failed_mgba", { reason: fakeSecret });

    const paths = buildRunPaths(evidenceDir, "redaction-check");
    const written = await Promise.all([
      readFile(paths.configFile, "utf8"),
      readFile(paths.turnFile(1), "utf8"),
      readFile(paths.errorFile(1), "utf8"),
      readFile(paths.summaryFile, "utf8")
    ]);

    expect(written.join("\n")).not.toContain(fakeSecret);
    expect(written.join("\n")).toContain("[REDACTED]");
  });
});

async function writeFixture(rootDir: string, fileName: string, content: string): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(rootDir, fileName), content, "utf8");
}

function fixedNow(): Date {
  return new Date("2026-05-22T00:00:00.000Z");
}
