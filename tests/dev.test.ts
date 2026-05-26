import { describe, expect, it } from "vitest";
import { buildDevHarnessArgs, formatDevRunBanner, runDev } from "../src/dev.js";
import type { AiProvider, HarnessConfig, HarnessMode } from "../src/config.js";

describe("dev command", () => {
  it("builds run args with a generated run id by default", () => {
    expect(buildDevHarnessArgs([], "dev-run")).toEqual([
      "run",
      "--run-id",
      "dev-run"
    ]);
  });

  it("preserves explicit user run options", () => {
    expect(buildDevHarnessArgs(["--max-turns", "3", "--run-id", "manual"], "generated")).toEqual([
      "run",
      "--max-turns",
      "3",
      "--run-id",
      "manual"
    ]);
  });

  it("strips agent subcommand and routes to run", () => {
    expect(buildDevHarnessArgs(["agent", "--run-id", "manual"], "generated")).toEqual([
      "run",
      "--run-id",
      "manual"
    ]);
  });

  it("ignores a package-manager argument separator", () => {
    expect(buildDevHarnessArgs(["--", "--max-turns", "5", "--run-id", "manual"], "generated")).toEqual([
      "run",
      "--max-turns",
      "5",
      "--run-id",
      "manual"
    ]);
  });

  it("starts the viewer with the same run id and closes it after the harness exits", async () => {
    const events: string[] = [];
    const io = createIo();
    const exitCode = await runDev(["--max-turns", "2", "--run-id", "dev-test"], io, {
      loadConfig(env) {
        return fakeConfig({
          aiProvider: parseAiProvider(env.AI_PROVIDER),
          harnessMode: parseHarnessMode(env.HARNESS_MODE),
          harnessRunId: env.HARNESS_RUN_ID ?? "missing",
        });
      },
      async startViewer(config) {
        events.push(`viewer:${config.harnessRunId}`);
        return {
          url: "http://127.0.0.1:8787",
          server: {} as never,
          async close() {
            events.push("viewer:closed");
          }
        };
      },
      async runCli(args) {
        events.push(`run:${args.join(" ")}`);
        return 0;
      }
    });

    expect(exitCode).toBe(0);
    expect(events).toEqual([
      "viewer:dev-test",
      "run:run --max-turns 2 --run-id dev-test",
      "viewer:closed"
    ]);
    expect(io.out.join("\n")).toContain("Dev viewer: http://127.0.0.1:8787");
    expect(io.out.join("\n")).toContain("Policy: openai");
  });

  it("generates a run id when HARNESS_RUN_ID is blank", async () => {
    const events: string[] = [];
    const previous = process.env.HARNESS_RUN_ID;
    process.env.HARNESS_RUN_ID = "";
    try {
      const exitCode = await runDev([], createIo(), {
        now: () => new Date("2026-05-23T00:00:00.000Z"),
        loadConfig(env) {
          return fakeConfig({ harnessRunId: env.HARNESS_RUN_ID ?? "missing" });
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
          events.push(`run:${args.join(" ")}`);
          return 0;
        }
      });

      expect(exitCode).toBe(0);
      expect(events).toEqual([
        "viewer:2026-05-23T00-00-00-000Z",
        "run:run --run-id 2026-05-23T00-00-00-000Z"
      ]);
    } finally {
      if (previous === undefined) {
        delete process.env.HARNESS_RUN_ID;
      } else {
        process.env.HARNESS_RUN_ID = previous;
      }
    }
  });

  it("prints a concise banner", () => {
    expect(formatDevRunBanner(fakeConfig({
      aiProvider: "openai",
    }))).toBe("Policy: openai");
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
  return "openai";
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
    harnessMode: "full-game",
    logLevel: "info",
    loopMaxSteps: 999_999,
    loopStepDelayMs: 0,
    defaultTapFrames: 5,
    defaultHoldFrames: 15,
    aiProvider: "openai",
    openaiBaseUrl: "http://192.168.0.100:3100/v1",
    openaiModel: "grok-4.3",
    openaiTemperature: 0.2,
    ...overrides
  };
}
