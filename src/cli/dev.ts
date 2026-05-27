import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createRunId } from "../evidence/EvidenceRecorder.js";
import { loadConfig, type HarnessConfig } from "./config.js";
import { getSupervisorSnapshot, runCli, type CliIo } from "./index.js";
import { MgbaHttpClient } from "../mgba/MgbaHttpClient.js";
import { startDevViewerServer, type StartedDevViewerServer } from "../viewer/DevViewerServer.js";
import { DevViewerHub } from "../viewer/DevViewerHub.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";
import type { AgentRunMode } from "../viewer/wsProtocol.js";

type AgentSessionStatus = "standby" | "running" | "stopping" | "finished";

export interface AgentController {
  start(mode: AgentRunMode, options?: { maxTurns?: number; loadSlot?: number }): void;
  stop(): void;
  getStatus(): { status: AgentSessionStatus; runId: string | undefined };
}

interface DevDependencies {
  readonly loadConfig?: (env: NodeJS.ProcessEnv) => HarnessConfig;
  readonly runCli?: (args: readonly string[], io: CliIo) => Promise<number>;
  readonly startViewer?: (
    config: HarnessConfig,
    agentMemoryStore?: { snapshot(): { sections: Record<string, Array<{ id: string; createdAt: string; content: string }>>; updatedAt: string } },
    supervisorSnapshot?: () => { plan: unknown | null; assessment: unknown | null; activeGoal: unknown | null; knowledgeBaseSize: number }
  ) => Promise<StartedDevViewerServer>;
  readonly now?: () => Date;
}

const DEFAULT_IO: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message)
};

export async function runDev(args: readonly string[] = process.argv.slice(2), io: CliIo = DEFAULT_IO, dependencies: DevDependencies = {}): Promise<number> {
  const normalizedArgs = stripSeparator(args);
  const baseRunId = nonEmpty(optionValue(normalizedArgs, "--run-id")) ?? nonEmpty(process.env.HARNESS_RUN_ID) ?? createRunId(dependencies.now?.() ?? new Date());
  const harnessArgs = buildDevHarnessArgs(normalizedArgs, baseRunId);
  const baseConfig = loadDevConfig(harnessArgs, dependencies.loadConfig ?? loadConfig);
  const mgbaClient = new MgbaHttpClient({ baseUrl: baseConfig.mgbaHttpBaseUrl });

  const viewer = await (dependencies.startViewer ?? createStartViewer(mgbaClient))(baseConfig, undefined, getSupervisorSnapshot);

  io.stdout(`Dev viewer: ${viewer.url}`);
  io.stdout(`WebSocket: ${viewer.url.replace("http", "ws")}/ws`);
  io.stdout(formatDevRunBanner(baseConfig));

  // Legacy/test mode: run agent directly and return when done
  if (dependencies.runCli) {
    try {
      return await dependencies.runCli(harnessArgs, io);
    } finally {
      await viewer.close();
    }
  }

  // Standby mode: server stays up, agent controlled via WebSocket
  io.stdout("Agent standby. Send agent:start via WebSocket to begin.");

  const controller = createAgentController({
    baseConfig,
    baseArgs: normalizedArgs,
    mgbaClient,
    io,
    dependencies,
    now: dependencies.now,
  });

  const hub = new DevViewerHub({
    runId: baseRunId,
    onButtonPress: async (button: string, frames: number) => {
      await mgbaClient.tapButton(button as MgbaButton, frames);
    },
    agentController: controller,
  });
  hub.attachToServer(viewer.server);

  hub.publish("agent:status", { status: "standby", runId: undefined });

  return new Promise<number>((resolve) => {
    const shutdown = async () => {
      controller.stop();
      hub.close();
      await viewer.close();
      resolve(0);
    };

    process.on("SIGINT", () => { shutdown(); });
    process.on("SIGTERM", () => { shutdown(); });
  });
}

export function buildDevHarnessArgs(args: readonly string[], runId: string): string[] {
  const normalizedArgs = stripSeparator(args);
  const forwarded = normalizedArgs[0] === "run" || normalizedArgs[0] === "agent"
    ? normalizedArgs.slice(1)
    : [...normalizedArgs];
  const result = ["run", ...forwarded];
  ensureOption(result, "--run-id", runId);
  return result;
}

export function formatDevRunBanner(config: Pick<HarnessConfig, "aiProvider">): string {
  return `Policy: ${config.aiProvider}`;
}

interface AgentControllerConfig {
  readonly baseConfig: HarnessConfig;
  readonly baseArgs: readonly string[];
  readonly mgbaClient: MgbaHttpClient;
  readonly io: CliIo;
  readonly dependencies: DevDependencies;
  readonly now?: () => Date;
}

function createAgentController(cfg: AgentControllerConfig): AgentController {
  let status: AgentSessionStatus = "standby";
  let activeRunId: string | undefined;
  let abortController: AbortController | undefined;

  return {
    start(mode, options) {
      if (status === "running") {
        cfg.io.stderr("Agent is already running. Stop first.");
        return;
      }

      const runId = createRunId(cfg.now?.() ?? new Date());
      activeRunId = runId;
      status = "running";

      const args = buildRunArgs(cfg.baseArgs, runId, mode, options);
      cfg.io.stdout(`Agent starting: mode=${mode} runId=${runId}${options?.loadSlot !== undefined ? ` loadSlot=${options.loadSlot}` : ""}`);

      abortController = new AbortController();
      runAgent(cfg, args, mode, options?.loadSlot, abortController.signal)
        .then((exitCode) => {
          cfg.io.stdout(`Agent finished: runId=${runId} exit=${exitCode}`);
        })
        .catch((error) => {
          cfg.io.stderr(`Agent error: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          status = "standby";
          activeRunId = undefined;
          abortController = undefined;
        });
    },

    stop() {
      if (status !== "running") {
        return;
      }
      status = "stopping";
      abortController?.abort();
      cfg.io.stdout("Agent stop requested.");
    },

    getStatus() {
      return { status, runId: activeRunId };
    },
  };
}

function buildRunArgs(
  baseArgs: readonly string[],
  runId: string,
  mode: AgentRunMode,
  options?: { maxTurns?: number; loadSlot?: number },
): string[] {
  const args: string[] = ["run", "--run-id", runId];

  if (mode === "continue") {
    const existingRunId = optionValue(baseArgs, "--run-id");
    if (existingRunId) {
      args[2] = existingRunId;
    }
  }

  if (options?.maxTurns !== undefined) {
    args.push("--max-turns", String(options.maxTurns));
  } else {
    const existingMaxTurns = optionValue(baseArgs, "--max-turns");
    if (existingMaxTurns) {
      args.push("--max-turns", existingMaxTurns);
    }
  }

  const existingReasoning = optionValue(baseArgs, "--reasoning");
  if (existingReasoning) {
    args.push("--reasoning", existingReasoning);
  }

  if (options?.loadSlot !== undefined) {
    args.push("--load-slot", String(options.loadSlot));
  } else if (mode === "reset") {
    args.push("--load-slot", "1");
  }

  return args;
}

async function runAgent(
  cfg: AgentControllerConfig,
  args: string[],
  _mode: AgentRunMode,
  loadSlot: number | undefined,
  signal: AbortSignal,
): Promise<number> {
  if (loadSlot !== undefined) {
    await cfg.mgbaClient.loadStateSlot(loadSlot);
    cfg.io.stdout(`Loaded savestate slot ${loadSlot}`);
  }

  if (signal.aborted) {
    return 1;
  }

  return (cfg.dependencies.runCli ?? runCli)(args, cfg.io);
}

function createStartViewer(mgbaClient: MgbaHttpClient) {
  return async (
    config: HarnessConfig,
    agentMemoryStore?: { snapshot(): { sections: Record<string, Array<{ id: string; createdAt: string; content: string }>>; updatedAt: string } },
    supervisorSnapshot?: () => { plan: unknown | null; assessment: unknown | null; activeGoal: unknown | null; knowledgeBaseSize: number },
  ): Promise<StartedDevViewerServer & { hub?: DevViewerHub }> => {
    const tapButton = async (button: string, frames: number) => {
      await mgbaClient.tapButton(button as MgbaButton, frames);
    };
    const started = await startDevViewerServer({
      client: mgbaClient,
      evidenceDir: config.evidenceDir,
      runId: config.harnessRunId,
      host: devViewerHost(),
      port: devViewerPort(),
      agentMemoryStore,
      supervisorSnapshot,
      onButtonPress: tapButton,
    });

    return started;
  };
}

function loadDevConfig(args: readonly string[], loader: (env: NodeJS.ProcessEnv) => HarnessConfig): HarnessConfig {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const runId = optionValue(args, "--run-id");

  if (runId !== undefined) {
    env.HARNESS_RUN_ID = runId;
  }

  return loader(env);
}

function ensureOption(args: string[], name: string, value: string): void {
  if (optionValue(args, name) === undefined) {
    args.push(name, value);
  }
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return;
  }
  return args[index + 1];
}

function stripSeparator(args: readonly string[]): readonly string[] {
  return args[0] === "--" ? args.slice(1) : args;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

function devViewerPort(): number {
  const raw = process.env.DEV_VIEWER_PORT;
  if (raw === undefined || raw.trim() === "") {
    return 8787;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 8787;
}

function devViewerHost(): string {
  const raw = process.env.DEV_VIEWER_HOST;
  if (raw === undefined || raw.trim() === "") {
    return "127.0.0.1";
  }
  return raw.trim();
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  process.exitCode = await runDev(args);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
