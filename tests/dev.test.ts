import { describe, expect, it } from "vitest";
import { buildDevHarnessArgs, runDev } from "../src/dev.js";
import type { AiProvider, HarnessConfig, HarnessMode } from "../src/config.js";

describe("dev command", () => {
  it("builds a full-game OpenAI vision run by default", () => {
    expect(buildDevHarnessArgs([])).toEqual([
      "run",
      "--policy",
      "openai",
      "--mode",
      "full-game",
      "--vision"
    ]);
  });

  it("hides generated run id and omitted max steps from default harness args", () => {
    const args = buildDevHarnessArgs([]);

    expect(args.join(" ")).toContain("run --policy openai --mode full-game --vision");
    expect(args).not.toContain("--run-id");
    expect(args).not.toContain("--max-steps");
  });

  it("preserves explicit user run options while forcing vision", () => {
    expect(buildDevHarnessArgs(["--policy", "heuristic", "--max-steps", "3"])).toEqual([
      "run",
      "--policy",
      "heuristic",
      "--max-steps",
      "3",
      "--mode",
      "full-game",
      "--vision"
    ]);
  });

  it("rejects manual run id switching in dev mode", () => {
    expect(() => buildDevHarnessArgs(["--run-id", "manual"])).toThrow(/do not pass --run-id/);
  });

  it("ignores a package-manager argument separator", () => {
    expect(buildDevHarnessArgs(["--", "--policy", "heuristic"])).toEqual([
      "run",
      "--policy",
      "heuristic",
      "--mode",
      "full-game",
      "--vision"
    ]);
  });

  it("starts the viewer with one generated run id and closes it after the harness exits", async () => {
    const events: string[] = [];
    const io = createIo();
    const exitCode = await runDev(["--policy", "heuristic", "--max-steps", "2"], io, {
      now: () => new Date("2026-05-23T00:00:00.000Z"),
      loadConfig(env) {
        return fakeConfig({
          aiProvider: parseAiProvider(env.AI_PROVIDER),
          harnessMode: parseHarnessMode(env.HARNESS_MODE),
          harnessRunId: env.HARNESS_RUN_ID ?? "missing",
          llmVisionEnabled: env.LLM_VISION_ENABLED === "true",
          loopMaxSteps: Number(env.LOOP_MAX_STEPS ?? 0)
        });
      },
      async startViewer(config) {
        events.push(`viewer:${config.harnessRunId}:${config.llmVisionEnabled}`);
        return {
          url: "http://127.0.0.1:8787",
          server: {} as never,
          async close() {
            events.push("viewer:closed");
          }
        };
      },
      async runCli(args) {
        events.push(`run:${args.join(" ")}:${process.env.HARNESS_RUN_ID ?? "missing"}`);
        return 0;
      }
    });

    expect(exitCode).toBe(0);
    expect(events).toEqual([
      "viewer:2026-05-23T00-00-00-000Z:true",
      "run:run --policy heuristic --max-steps 2 --mode full-game --vision:2026-05-23T00-00-00-000Z",
      "viewer:closed"
    ]);
    expect(io.out.join("\n")).toContain("Dev viewer: http://127.0.0.1:8787");
  });

  it("generates a run id when HARNESS_RUN_ID is blank", async () => {
    const events: string[] = [];
    const previous = process.env.HARNESS_RUN_ID;
    process.env.HARNESS_RUN_ID = "";
    try {
      const exitCode = await runDev([], createIo(), {
        now: () => new Date("2026-05-23T00:00:00.000Z"),
        loadConfig(env) {
          return fakeConfig({
            harnessRunId: env.HARNESS_RUN_ID ?? "missing",
            llmVisionEnabled: env.LLM_VISION_ENABLED === "true",
            loopMaxSteps: Number(env.LOOP_MAX_STEPS ?? 0)
          });
        },
        async startViewer(config) {
          events.push(`viewer:${config.harnessRunId}`);
          return {
            url: "http://127.0.0.1:8787",
            server: {} as never,
            async close() {}
          };
        },
        async runCli(args) {
          events.push(`run:${args.join(" ")}:${process.env.HARNESS_RUN_ID ?? "missing"}`);
          return 0;
        }
      });

      expect(exitCode).toBe(0);
      expect(events).toEqual([
        "viewer:2026-05-23T00-00-00-000Z",
        "run:run --policy openai --mode full-game --vision:2026-05-23T00-00-00-000Z"
      ]);
      expect(process.env.HARNESS_RUN_ID).toBe("");
    } finally {
      if (previous === undefined) {
        delete process.env.HARNESS_RUN_ID;
      } else {
        process.env.HARNESS_RUN_ID = previous;
      }
    }
  });

  it("does not use HARNESS_RUN_ID as a dev session override", async () => {
    const events: string[] = [];
    const previous = process.env.HARNESS_RUN_ID;
    process.env.HARNESS_RUN_ID = "manual-env-run";
    try {
      const exitCode = await runDev([], createIo(), {
        now: () => new Date("2026-05-23T00:00:00.000Z"),
        loadConfig(env) {
          return fakeConfig({
            harnessRunId: env.HARNESS_RUN_ID ?? "missing",
            llmVisionEnabled: env.LLM_VISION_ENABLED === "true"
          });
        },
        async startViewer(config) {
          events.push(`viewer:${config.harnessRunId}`);
          return {
            url: "http://127.0.0.1:8787",
            server: {} as never,
            async close() {}
          };
        },
        async runCli(args) {
          events.push(`run:${args.join(" ")}:${process.env.HARNESS_RUN_ID ?? "missing"}`);
          return 0;
        }
      });

      expect(exitCode).toBe(0);
      expect(events).toEqual([
        "viewer:2026-05-23T00-00-00-000Z",
        "run:run --policy openai --mode full-game --vision:2026-05-23T00-00-00-000Z"
      ]);
      expect(process.env.HARNESS_RUN_ID).toBe("manual-env-run");
    } finally {
      if (previous === undefined) {
        delete process.env.HARNESS_RUN_ID;
      } else {
        process.env.HARNESS_RUN_ID = previous;
      }
    }
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

function parseAiProvider(value: string | undefined): AiProvider {
  return value === "openai" ? "openai" : "heuristic";
}

function parseHarnessMode(value: string | undefined): HarnessMode {
  return value === "full-game" ? "full-game" : "stage1";
}

function fakeConfig(overrides: Partial<HarnessConfig>): HarnessConfig {
  return {
    mgbaHttpBaseUrl: "http://127.0.0.1:5001",
    pokemonVersion: "red",
    evidenceDir: "runs",
    harnessRunId: "dev-test",
    harnessMode: "stage1",
    logLevel: "info",
    loopMaxSteps: 1000,
    loopStepDelayMs: 0,
    maxLlmCalls: 400,
    llmTimeoutMs: 20000,
    llmMaxRetries: 1,
    defaultTapFrames: 5,
    defaultHoldFrames: 15,
    aiProvider: "heuristic",
    openaiBaseUrl: "https://example.invalid/v1",
    openaiModel: "gpt-5.5",
    openaiTemperature: 0.2,
    llmVisionEnabled: false,
    llmVisionMaxImages: 3,
    llmVisionCropLeft: 0,
    llmVisionCropTop: 0,
    llmVisionCropWidth: 0,
    llmVisionCropHeight: 0,
    llmVisionMaxWidth: 512,
    llmVisionMaxHeight: 384,
    llmVisionFormat: "jpeg",
    llmVisionQuality: 70,
    llmVisionDetail: "low",
    ...overrides
  };
}
