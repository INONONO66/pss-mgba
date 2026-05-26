import "dotenv/config";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { Controller } from "./control/Controller.js";
import type { MgbaButton } from "./mgba/MgbaTypes.js";
import { MGBA_BUTTONS } from "./mgba/MgbaTypes.js";
import { HarnessActionSchema } from "./control/ActionSchema.js";
import { loadConfig, type HarnessConfig } from "./config.js";
import { CommandAgentRunner } from "./agent/CommandAgentRunner.js";
import type { DynamicReasoningEffort } from "./agent/dynamic-llm.js";
import { redactSecrets } from "./evidence/redaction.js";
import { HarnessError } from "./errors.js";

import { MgbaHttpClient } from "./mgba/MgbaHttpClient.js";
import { runMgbaPreflight, type MgbaPreflightReport } from "./mgba/preflight.js";

type HarnessCommand = "preflight" | "run" | "press" | "agent";

export interface CliOptions {
  readonly command?: HarnessCommand;
  readonly help: boolean;
  readonly runId?: string;
  readonly maxTurns?: number;
  readonly pressButton?: string;
  readonly pressFrames?: number;
  readonly reasoning?: DynamicReasoningEffort;
}

export interface CliIo {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

export interface CliFactories {
  readonly loadConfig?: (env: NodeJS.ProcessEnv) => HarnessConfig;
  readonly createRunner?: (config: HarnessConfig, options: { maxTurns?: number; reasoning?: DynamicReasoningEffort }) => CliRunner;
  readonly runPreflight?: (config: HarnessConfig) => Promise<MgbaPreflightReport>;
  readonly executePress?: (config: HarnessConfig, action: unknown) => Promise<void>;
}

export interface CliRunner {
  run(): Promise<{ readonly status: string }>;
}

interface ParsedOptionResult {
  readonly options: CliOptions;
  readonly errors: string[];
}

const DEFAULT_IO: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message)
};

export function getHarnessHelp(): string {
  return [
    "Pokemon Red/Blue AI harness CLI",
    "",
    "Usage:",
    "  pnpm run harness --help",
    "  pnpm run harness run [--run-id ID] [--max-turns N] [--reasoning MODE]",
    "  pnpm run harness agent [--run-id ID] [--max-turns N] [--reasoning MODE]",
    "  pnpm run harness preflight",
    "  pnpm run harness press BUTTON [--frames N]",
    "",
    "Commands:",
    "  run        Start the command agent loop (default). Supports --max-turns, --run-id, and --reasoning.",
    "  agent      Alias for run.",
    "  preflight  Run mGBA preflight against the running emulator.",
    "  press      Send one safe Game Boy button press.",
  ].join("\n");
}

export function parseCliArgs(args: readonly string[]): ParsedOptionResult {
  const errors: string[] = [];
  const options: MutableCliOptions = { help: false };
  const rest: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--run-id":
        options.runId = parseNonEmpty(args[++index], "--run-id", errors);
        break;
      case "--max-turns":
        options.maxTurns = parsePositiveInteger(args[++index], "--max-turns", errors);
        break;
      case "--reasoning":
        options.reasoning = parseReasoningEffort(args[++index], errors);
        break;
      case "--frames":
        options.pressFrames = parsePositiveInteger(args[++index], "--frames", errors);
        break;
      default:
        if (arg?.startsWith("--") === true) {
          errors.push(`Unknown option: ${arg}`);
        } else if (arg !== undefined) {
          rest.push(arg);
        }
    }
  }

  const command = rest[0];
  if (command !== undefined) {
    if (isHarnessCommand(command)) {
      options.command = command;
      if (command === "press") {
        options.pressButton = rest[1];
        if (rest.length > 2) {
          errors.push(`Unexpected argument for press: ${rest.slice(2).join(" ")}`);
        }
      } else if (rest.length > 1) {
        errors.push(`Unexpected argument for ${command}: ${rest.slice(1).join(" ")}`);
      }
    } else {
      errors.push(`Unknown command: ${command}`);
    }
  }

  return { options, errors };
}

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  io: CliIo = DEFAULT_IO,
  factories: CliFactories = {}
): Promise<number> {
  const parsed = parseCliArgs(args);
  if (parsed.options.help || args.length === 0) {
    io.stdout(getHarnessHelp());
    return parsed.errors.length === 0 ? 0 : 1;
  }

  if (parsed.errors.length > 0) {
    io.stderr(parsed.errors.join("\n"));
    io.stderr("\n" + getHarnessHelp());
    return 1;
  }

  try {
    switch (parsed.options.command) {
      case "preflight":
        return await handlePreflight(parsed.options, io, factories);
      case "run":
      case "agent":
        return await handleRun(parsed.options, io, factories);
      case "press":
        return await handlePress(parsed.options, io, factories);
      default:
        io.stderr(`Missing command.\n${getHarnessHelp()}`);
        return 1;
    }
  } catch (error) {
    io.stderr(formatSafeError(error));
    return 1;
  }
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  process.exitCode = await runCli(args);
}

function loadCommandConfig(options: CliOptions, factories: CliFactories): HarnessConfig {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.runId !== undefined) {
    env.HARNESS_RUN_ID = options.runId;
  }
  return (factories.loadConfig ?? loadConfig)(env);
}

async function handlePreflight(options: CliOptions, io: CliIo, factories: CliFactories): Promise<number> {
  const config = loadCommandConfig(options, factories);
  const report = await (factories.runPreflight ?? ((loadedConfig) => runMgbaPreflight({ config: loadedConfig })))(config);
  io.stdout(formatPreflightReport(report));
  return report.ok ? 0 : 1;
}

async function handleRun(options: CliOptions, io: CliIo, factories: CliFactories): Promise<number> {
  const config = loadCommandConfig(options, factories);
  const runnerOptions = { maxTurns: options.maxTurns, reasoning: options.reasoning };
  const runner = factories.createRunner
    ? factories.createRunner(config, runnerOptions)
    : new CommandAgentRunner(config, runnerOptions);
  const result = await runner.run();
  io.stdout(redactSecrets({ command: "run", result }));
  return result.status === "completed" ? 0 : 1;
}

async function handlePress(options: CliOptions, io: CliIo, factories: CliFactories): Promise<number> {
  const config = loadCommandConfig(options, factories);
  const frames = options.pressFrames ?? config.defaultTapFrames;
  const action = { type: "press", button: options.pressButton, frames };
  const parsed = HarnessActionSchema.safeParse(action);
  if (!parsed.success || parsed.data.type !== "press") {
    throw new HarnessError("ACTION_REJECTED", "press requires a safe Game Boy button and frame count", {
      context: { allowedButtons: MGBA_BUTTONS, frames }
    });
  }

  await (factories.executePress ?? executePress)(config, parsed.data);
  io.stdout(redactSecrets({ command: "press", action: parsed.data, status: "executed" }));
  return 0;
}

async function executePress(config: HarnessConfig, action: { type: "press"; button: MgbaButton; frames: number }): Promise<void> {
  const client = new MgbaHttpClient({ baseUrl: config.mgbaHttpBaseUrl });
  const controller = new Controller({
    client,
    defaultTapFrames: config.defaultTapFrames,
    defaultHoldFrames: config.defaultHoldFrames
  });
  await controller.execute(action);
}

function formatPreflightReport(report: MgbaPreflightReport): string {
  const lines = [
    `mGBA preflight ${report.ok ? "passed" : "failed"}`,
    "",
    ...report.checks.map((check) => {
      const parts = [`[${check.status}] ${check.name}: ${check.message}`];
      if (check.guidance !== undefined) {
        parts.push(`  Guidance: ${check.guidance}`);
      }
      if (check.errorCode !== undefined) {
        parts.push(`  Code: ${check.errorCode}`);
      }
      return parts.join("\n");
    })
  ];

  if (!report.ok) {
    lines.push("", "Setup: start mGBA manually with mGBA-http enabled, load a Pokemon Red or Blue ROM that you provide, and check MGBA_HTTP_BASE_URL.");
  }

  return redactSecrets(lines.join("\n"));
}

function formatSafeError(error: unknown): string {
  if (error instanceof HarnessError) {
    return redactSecrets(`${error.code}: ${error.message}`);
  }
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }

  return redactSecrets(inspect(error));
}

function parsePositiveInteger(value: string | undefined, name: string, errors: string[]): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    errors.push(`${name} must be a positive integer`);
    return undefined;
  }
  return parsed;
}

function parseNonEmpty(value: string | undefined, name: string, errors: string[]): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    errors.push(`${name} must not be empty`);
    return undefined;
  }
  return value;
}

function parseReasoningEffort(value: string | undefined, errors: string[]): DynamicReasoningEffort | undefined {
  if (value === undefined || value.trim().length === 0) {
    errors.push("--reasoning must not be empty");
    return undefined;
  }

  if (
    value === "provider-default" ||
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }

  errors.push("--reasoning must be one of: provider-default, none, minimal, low, medium, high, xhigh");
  return undefined;
}

function isHarnessCommand(value: string): value is HarnessCommand {
  return value === "preflight" || value === "run" || value === "press" || value === "agent";
}

interface MutableCliOptions {
  command?: HarnessCommand;
  help: boolean;
  runId?: string;
  maxTurns?: number;
  pressButton?: string;
  pressFrames?: number;
  reasoning?: DynamicReasoningEffort;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
