import { describe, expect, it } from "vitest";
import { getHarnessHelp, parseCliArgs, runCli } from "../../src/index.js";
import type { MgbaPreflightReport } from "../../src/mgba/preflight.js";

describe("CLI", () => {
  it("prints command help", async () => {
    const io = createIo();

    const exitCode = await runCli(["--help"], io);

    expect(exitCode).toBe(0);
    const output = io.out.join("\n");
    expect(output).toBe(getHarnessHelp());
    expect(output).toContain("pnpm run harness run");
    expect(output).toContain("navigate, battle, dialog");
  });

  it("parses run command with --run-id", () => {
    const parsed = parseCliArgs(["run", "--run-id", "my-run"]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.options).toMatchObject({ command: "run", runId: "my-run" });
  });

  it("parses press command with --frames", () => {
    const parsed = parseCliArgs(["press", "A", "--frames", "10"]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.options).toMatchObject({ command: "press", pressButton: "A", pressFrames: 10 });
  });

  it("rejects unknown options", () => {
    const parsed = parseCliArgs(["run", "--policy", "openai"]);

    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("formats preflight failures as guidance without stack noise", async () => {
    const io = createIo();
    const exitCode = await runCli(["preflight"], io, {
      async runPreflight(): Promise<MgbaPreflightReport> {
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
  });

  it("constructs run dependencies through the runner factory", async () => {
    const io = createIo();
    let factoryCalled = false;
    const exitCode = await runCli(["run", "--run-id", "cli-test"], io, {
      createRunner() {
        factoryCalled = true;
        return {
          async run() {
            return { status: "completed" };
          }
        };
      }
    });

    expect(exitCode).toBe(0);
    expect(factoryCalled).toBe(true);
    expect(io.out.join("\n")).toContain("completed");
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

  it("keeps help expectations meaningful", () => {
    expect(getHarnessHelp()).toContain("Pokemon Red/Blue AI harness CLI");
    expect(getHarnessHelp()).toContain("preflight");
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
