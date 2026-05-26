import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createRunId } from "./evidence/EvidenceRecorder.js";
import { loadConfig, type HarnessConfig } from "./config.js";
import { runCli, type CliIo } from "./index.js";
import { MgbaHttpClient } from "./mgba/MgbaHttpClient.js";
import { startDevViewerServer, type StartedDevViewerServer } from "./viewer/DevViewerServer.js";

export interface DevDependencies {
  readonly loadConfig?: (env: NodeJS.ProcessEnv) => HarnessConfig;
  readonly runCli?: (args: readonly string[], io: CliIo) => Promise<number>;
  readonly startViewer?: (config: HarnessConfig, agentMemoryStore?: { snapshot(): { sections: Record<string, Array<{ id: string; createdAt: string; content: string }>>; updatedAt: string } }) => Promise<StartedDevViewerServer>;
  readonly now?: () => Date;
}

const DEFAULT_IO: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message)
};

export async function runDev(args: readonly string[] = process.argv.slice(2), io: CliIo = DEFAULT_IO, dependencies: DevDependencies = {}): Promise<number> {
  const normalizedArgs = stripSeparator(args);
  const runId = nonEmpty(optionValue(normalizedArgs, "--run-id")) ?? nonEmpty(process.env.HARNESS_RUN_ID) ?? createRunId(dependencies.now?.() ?? new Date());
  const harnessArgs = buildDevHarnessArgs(normalizedArgs, runId);
  const config = loadDevConfig(harnessArgs, dependencies.loadConfig ?? loadConfig);
  const viewer = await (dependencies.startViewer ?? startViewer)(config, undefined);

  io.stdout(`Dev viewer: ${viewer.url}`);
  io.stdout(`Run ID: ${config.harnessRunId}`);
  io.stdout(formatDevRunBanner(config));

  try {
    return await (dependencies.runCli ?? runCli)(harnessArgs, io);
  } finally {
    await viewer.close();
  }
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

function startViewer(config: HarnessConfig, agentMemoryStore?: { snapshot(): { sections: Record<string, Array<{ id: string; createdAt: string; content: string }>>; updatedAt: string } }): Promise<StartedDevViewerServer> {
  return startDevViewerServer({
    client: new MgbaHttpClient({ baseUrl: config.mgbaHttpBaseUrl }),
    evidenceDir: config.evidenceDir,
    runId: config.harnessRunId,
    port: devViewerPort(),
    agentMemoryStore
  });
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

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  process.exitCode = await runDev(args);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
