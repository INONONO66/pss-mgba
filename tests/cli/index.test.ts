import { describe, expect, it } from "vitest";
import type { HarnessConfig } from "../../src/config.js";
import { getHarnessHelp, parseCliArgs, runCli } from "../../src/index.js";
import type { MgbaPreflightReport } from "../../src/mgba/preflight.js";

describe("CLI", () => {
  it("prints command help", async () => {
    const io = createIo();

    const exitCode = await runCli(["--help"], io);

    expect(exitCode).toBe(0);
    const usageBlock = [
      "Usage:",
      "  pnpm run harness --help",
      "  pnpm run harness snapshot [--dry-run] [--policy heuristic|openai] [--mode stage1|full-game] [--vision] [--max-steps N] [--run-id ID]",
      "  pnpm run harness preflight [--policy heuristic|openai] [--mode stage1|full-game] [--vision] [--run-id ID]",
      "  pnpm run harness run [--policy heuristic|openai] [--mode stage1|full-game] [--vision] [--max-steps N] [--run-id ID]",
      "  pnpm run harness press BUTTON [--frames N] [--run-id ID]",
      "  pnpm run smoke:mgba"
    ].join("\n");
    const output = io.out.join("\n");
    const harnessHelp = getHarnessHelp();
    expect(output).toBe(harnessHelp);
    expect(harnessHelp.slice(harnessHelp.indexOf("Usage:"), harnessHelp.indexOf("\n\nCommands:"))).toBe(usageBlock);
    expect(harnessHelp).toContain("--max-steps N  Optional step cap override. Omit it and LOOP_MAX_STEPS for no step cap.");
    expect(harnessHelp).toContain("--run-id ID    Optional HARNESS_RUN_ID override for evidence paths. Omit it to generate a run id.");
  });

  it("parses commands and common options without a CLI framework", () => {
    const parsed = parseCliArgs(["run", "--policy", "openai", "--mode", "full-game", "--vision", "--max-steps", "9", "--run-id", "manual"]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.options).toMatchObject({ command: "run", policy: "openai", mode: "full-game", vision: true, maxSteps: 9, runId: "manual" });
  });

  it("rejects unsupported policy names", () => {
    const parsed = parseCliArgs(["run", "--policy", "codexlb"]);

    expect(parsed.errors).toEqual(["--policy must be heuristic or openai"]);
    expect(parsed.options.policy).toBeUndefined();
  });

  it("rejects unsupported mode names", () => {
    const parsed = parseCliArgs(["run", "--mode", "credits"]);

    expect(parsed.errors).toEqual(["--mode must be stage1 or full-game"]);
    expect(parsed.options.mode).toBeUndefined();
  });

  it("runs snapshot dry-run without constructing live dependencies or requiring an API key", async () => {
    const io = createIo();
    let runnerConstructed = false;

    const exitCode = await withEnv({ AI_PROVIDER: "openai", HARNESS_MODE: undefined, OPENAI_API_KEY: undefined }, () => runCli(["snapshot", "--dry-run"], io, {
      createRunner() {
        runnerConstructed = true;
        throw new Error("runner should not be constructed");
      }
    }));

    const output = io.out.join("\n");
    expect(exitCode).toBe(0);
    expect(runnerConstructed).toBe(false);
    expect(output).toContain("Snapshot dry run succeeded");
    expect(output).toContain('"harnessMode": "stage1"');
    expect(output).toContain('"aiProvider": "heuristic"');
    expect(output).not.toContain("hasOpenaiApiKey");
    expect(output).not.toContain("sk-");
  });

  it("passes CLI mode override into loaded config and dry-run summary", async () => {
    const io = createIo();

    const exitCode = await runCli(["snapshot", "--dry-run", "--mode", "full-game"], io);

    expect(exitCode).toBe(0);
    expect(io.out.join("\n")).toContain('"harnessMode": "full-game"');
  });

  it("passes --vision into loaded config and dry-run summary", async () => {
    const io = createIo();

    const exitCode = await runCli(["snapshot", "--dry-run", "--vision"], io);

    expect(exitCode).toBe(0);
    expect(io.out.join("\n")).toContain('"llmVisionEnabled": true');
  });

  it("prints a secret-safe OpenAI-compatible dry-run summary for custom base URLs", async () => {
    const io = createIo();

    const exitCode = await withEnv({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "provider-key-must-not-appear",
      OPENAI_BASE_URL: "https://codex.example.invalid/v1",
      OPENAI_MODEL: "codex-compatible-model"
    }, () => runCli(["snapshot", "--dry-run"], io));

    const output = io.out.join("\n");
    expect(exitCode).toBe(0);
    expect(output).toContain('"aiProvider": "openai"');
    expect(output).toContain('"hasOpenaiApiKey": true');
    expect(output).toContain('"openaiBaseUrl": "https://codex.example.invalid/v1"');
    expect(output).toContain('"openaiModel": "codex-compatible-model"');
    expect(output).not.toContain("provider-key-must-not-appear");
  });

  it("formats preflight failures as guidance without stack noise", async () => {
    const io = createIo();
    const seenConfigs: HarnessConfig[] = [];
    const exitCode = await runCli(["preflight", "--vision"], io, {
      async runPreflight(config): Promise<MgbaPreflightReport> {
        seenConfigs.push(config);
        return {
          ok: false,
          checks: [
            {
              name: "current_frame",
              status: "fail",
              message: "mGBA-http request could not be completed",
              guidance: "Start mGBA manually with mGBA-http enabled and verify MGBA_HTTP_BASE_URL points to it.",
              errorCode: "MGBA_UNAVAILABLE"
            }
          ]
        };
      }
    });

    const output = io.out.join("\n");
    expect(exitCode).toBe(1);
    expect(output).toContain("mGBA preflight failed");
    expect(output).toContain("Start mGBA manually");
    expect(output).not.toContain("Error:");
    expect(output).not.toContain("    at ");
    expect(seenConfigs[0]?.llmVisionEnabled).toBe(true);
  });

  it("constructs run dependencies through the runner factory", async () => {
    const io = createIo();
    const seen: Array<{ config: HarnessConfig; maxSteps?: number }> = [];
    const exitCode = await withEnv({ OPENAI_API_KEY: "unit-test-key" }, () => runCli(["run", "--policy", "openai", "--mode", "full-game", "--vision", "--max-steps", "2", "--run-id", "cli-test"], io, {
      createRunner(config, options) {
        seen.push({ config, maxSteps: options.maxSteps });
        return {
          async snapshot() {
            throw new Error("snapshot should not run");
          },
          async run() {
            return {
              runId: config.harnessRunId,
              status: "completed",
              startedAt: "2026-05-22T00:00:00.000Z",
              completedAt: "2026-05-22T00:00:01.000Z",
              totalSteps: options.maxSteps ?? 0,
              checkpoints: { initialObserved: true, starterAcquired: true, rivalBattleEntered: true, rivalBattleExited: true, completed: true },
              detector: {},
              last20Actions: [],
              recentStateHashes: []
            };
          }
        };
      }
    }));

    expect(exitCode).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.config.aiProvider).toBe("openai");
    expect(seen[0]?.config.harnessMode).toBe("full-game");
    expect(seen[0]?.config.llmVisionEnabled).toBe(true);
    expect(seen[0]?.config.harnessRunId).toBe("cli-test");
    expect(seen[0]?.maxSteps).toBe(2);
    expect(io.out.join("\n")).toContain("completed");
  });

  it("streams debug logs to stderr while keeping the run result on stdout", async () => {
    const io = createIo();

    const exitCode = await withEnv({ HARNESS_INLINE_DEBUG_LOGS: undefined }, () => runCli(["run", "--policy", "heuristic"], io, {
      createRunner(_config, options) {
        return {
          async snapshot() {
            throw new Error("snapshot should not run");
          },
          async run() {
            options.debugEventSink?.({
              type: "decision",
              timestamp: "2026-05-22T00:00:00.000Z",
              payload: { step: 1, frame: 2, decision: { action: { type: "wait", frames: 1 }, confidence: 0.7, rationale: "safe choice" } }
            });
            options.debugEventSink?.({
              type: "action",
              timestamp: "2026-05-22T00:00:01.000Z",
              payload: { step: 1, frame: 2, action: { type: "wait", frames: 1 }, confidence: 0.7, rationale: "safe choice" }
            });
            options.debugEventSink?.({
              type: "error",
              timestamp: "2026-05-22T00:00:02.000Z",
              payload: { error: { code: "LLM_UNAVAILABLE", message: `api key s${"k"}-unit-test-token leaked` } }
            });
            options.debugEventSink?.({
              type: "run_finished",
              timestamp: "2026-05-22T00:00:03.000Z",
              payload: { runId: "cli-debug", status: "completed", counts: { decisions: 1, actions: 1, errors: 1 }, result: { status: "completed" } }
            });
            return { status: "completed" };
          }
        };
      }
    }));

    const stdout = io.out.join("\n");
    const stderr = io.err.join("\n");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"command": "run"');
    expect(stdout).toContain('"status": "completed"');
    expect(stdout).not.toContain("decision");
    expect(stderr).toContain("decision step=1 frame=2 action=");
    expect(stderr).toContain("action step=1 frame=2 action=");
    expect(stderr).toContain("error error=");
    expect(stderr).toContain("run_finished status=completed runId=cli-debug");
    expect(stderr).toContain("[REDACTED]");
    expect(stderr).not.toContain(`s${"k"}-unit-test-token`);
  });

  it("disables debug logs when HARNESS_INLINE_DEBUG_LOGS uses an off value", async () => {
    for (const disabledValue of ["0", "false", "no", "off", " OFF "]) {
      const io = createIo();
      const exitCode = await withEnv({ HARNESS_INLINE_DEBUG_LOGS: disabledValue }, () => runCli(["run", "--policy", "heuristic"], io, {
        createRunner(_config, options) {
          expect(options.debugEventSink).toBeUndefined();
          return {
            async snapshot() {
              throw new Error("snapshot should not run");
            },
            async run() {
              return { status: "completed" };
            }
          };
        }
      }));

      expect(exitCode).toBe(0);
      expect(io.err).toEqual([]);
      expect(io.out.join("\n")).toContain('"command": "run"');
    }
  });

  it("constructs run dependencies without run-id or max steps", async () => {
    const io = createIo();
    const seen: Array<{ config: HarnessConfig; maxSteps?: number }> = [];
    const exitCode = await withEnv({ HARNESS_RUN_ID: undefined }, () => runCli(["run", "--policy", "heuristic"], io, {
      createRunner(config, options) {
        seen.push({ config, maxSteps: options.maxSteps });
        return {
          async snapshot() {
            throw new Error("snapshot should not run");
          },
          async run() {
            return { status: "completed" };
          }
        };
      }
    }));

    expect(exitCode).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.config.aiProvider).toBe("heuristic");
    expect(seen[0]?.config.harnessRunId).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(seen[0]?.config.harnessRunId.length).toBeGreaterThan(0);
    expect(seen[0]?.maxSteps).toBeUndefined();
    expect(io.out.join("\n")).toContain("completed");
  });

  it("preserves env run id when run omits run-id and max steps", async () => {
    const io = createIo();
    const seen: Array<{ config: HarnessConfig; maxSteps?: number }> = [];
    const exitCode = await withEnv({ HARNESS_RUN_ID: "env-run" }, () => runCli(["run", "--policy", "heuristic"], io, {
      createRunner(config, options) {
        seen.push({ config, maxSteps: options.maxSteps });
        return {
          async snapshot() {
            throw new Error("snapshot should not run");
          },
          async run() {
            return { status: "completed" };
          }
        };
      }
    }));

    expect(exitCode).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.config.aiProvider).toBe("heuristic");
    expect(seen[0]?.config.harnessRunId).toBe("env-run");
    expect(seen[0]?.maxSteps).toBeUndefined();
  });

  it("validates press through the action schema before executing", async () => {
    const io = createIo();
    const actions: unknown[] = [];

    const okExit = await runCli(["press", "A", "--frames", "3"], io, {
      async executePress(_config, action) {
        actions.push(action);
      }
    });
    const badExit = await runCli(["press", "L", "--frames", "3"], createIo(), {
      async executePress(_config, action) {
        actions.push(action);
      }
    });

    expect(okExit).toBe(0);
    expect(badExit).toBe(1);
    expect(actions).toEqual([{ type: "press", button: "A", frames: 3 }]);
  });

  it("keeps legacy scaffold help expectations meaningful", () => {
    expect(getHarnessHelp()).toContain("Pokemon Red/Blue AI harness CLI");
    expect(getHarnessHelp()).toContain("mGBA preflight");
  });
});

function createIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout(message: string) {
      out.push(message);
    },
    stderr(message: string) {
      err.push(message);
    }
  };
}

async function withEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
