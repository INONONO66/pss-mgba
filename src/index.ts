import "dotenv/config";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { HeuristicCommandPolicy } from "./ai/HeuristicPolicy.js";
import { LLMCommandPolicy } from "./ai/LLMPolicy.js";
import { Controller } from "./control/Controller.js";
import type { MgbaButton } from "./mgba/MgbaTypes.js";
import { MGBA_BUTTONS } from "./mgba/MgbaTypes.js";
import { HarnessActionSchema } from "./control/ActionSchema.js";
import { loadConfig, type AiProvider, type HarnessConfig } from "./config.js";
import { redactSecrets } from "./evidence/redaction.js";
import { HarnessError } from "./errors.js";
import { CommandHarnessRunner, type CommandRunnerGameState } from "./loop/CommandHarnessRunner.js";

import { MgbaHttpClient } from "./mgba/MgbaHttpClient.js";
import { runMgbaPreflight, type MgbaPreflightReport } from "./mgba/preflight.js";
import { PokemonStateReader } from "./pokemon/PokemonStateReader.js";
import { FullGameDetector } from "./pokemon/FullGameDetector.js";
import { Stage1Detector } from "./pokemon/Stage1Detector.js";
import { MapMemory } from "./pokemon/MapMemory.js";
import { MapGraph, type MapGraphInput } from "./pokemon/MapGraph.js";
import { readGameWorld, type GameWorldSnapshot } from "./pokemon/GameWorld.js";
import type { ExecutionContext } from "./executor/CommandExecutor.js";
import {
  createUnifiedController,
  createNavigateWorldReader,
  createNavigateMapSource,
  createInteractStateReader,
  createDialogStateReader,
  toCommandGameMode,
} from "./executor/MgbaAdapters.js";

type HarnessCommand = "preflight" | "run" | "press";

export interface CliOptions {
  readonly command?: HarnessCommand;
  readonly help: boolean;
  readonly runId?: string;
  readonly pressButton?: string;
  readonly pressFrames?: number;
}

export interface CliIo {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

export interface CliFactories {
  readonly loadConfig?: (env: NodeJS.ProcessEnv) => HarnessConfig;
  readonly createRunner?: (config: HarnessConfig) => CliRunner;
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
    "  pnpm run harness run [--run-id ID]",
    "  pnpm run harness preflight",
    "  pnpm run harness press BUTTON [--frames N]",
    "",
    "Commands:",
    "  run        Start the harness loop. LLM issues high-level commands (navigate, battle, dialog).",
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
        return await handleRun(parsed.options, io, factories);
      case "press":
        return await handlePress(parsed.options, io, factories);
      default:
        io.stderr("Missing command.\n" + getHarnessHelp());
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
  const runner = (factories.createRunner ?? createRunner)(config);
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

function createRunner(config: HarnessConfig): CliRunner {
  const client = new MgbaHttpClient({ baseUrl: config.mgbaHttpBaseUrl });
  const stateReader = new PokemonStateReader({ client, version: config.pokemonVersion });
  const mapMemory = new MapMemory();
  const mapGraph = new MapGraph();
  const detector = createDetector(config);

  const ram = { read8: (a: number) => client.read8(a), readRange: (a: number, l: number) => client.readRange(a, l), holdButton: (b: MgbaButton, f: number) => client.holdButton(b, f) };
  const controller = createUnifiedController(ram);
  const navigateWorldReader = createNavigateWorldReader(ram);
  const navigateMapSource = createNavigateMapSource(mapMemory);
  const interactStateReader = createInteractStateReader(ram);
  const dialogStateReader = createDialogStateReader(ram);

  const heuristicPolicy = new HeuristicCommandPolicy();
  const policy = isLlmProvider(config.aiProvider)
    ? LLMCommandPolicy.fromConfig(config, heuristicPolicy)
    : heuristicPolicy;

  const executionContext: ExecutionContext = {
    mode: "overworld",
    fullState: undefined as unknown as ExecutionContext["fullState"],
    mapWidth: 0,
    mapHeight: 0,
    controller,
    navigateWorldReader,
    navigateMapSource,
    interactStateReader,
    dialogStateReader,
  };

  let lastWorld: GameWorldSnapshot | undefined;

  const readGameState = async (): Promise<CommandRunnerGameState> => {
    const world = await readGameWorld(client);
    lastWorld = world;
    const menuText = await stateReader.readMenuTextState({ tileMapBytes: world.tileMapBytes });
    const fullState = await stateReader.readFullState({ menuText });
    return {
      fullState,
      mode: toCommandGameMode(world.mode),
      mapId: world.mapLayout.mapId,
      playerY: world.playerCoords.y,
      playerX: world.playerCoords.x,
      facing: fullState.player.facing.direction,
      mapWidth: world.mapLayout.width * 2,
      mapHeight: world.mapLayout.height * 2,
    };
  };

  const updateMapMemory = async () => {
    if (lastWorld) {
      mapMemory.update(lastWorld, lastWorld.tileMapBytes);
    }
  };

  const updateMapGraph = () => {
    const inputs: MapGraphInput[] = mapMemory.visitedMaps().map((mapId) => {
      const warps = lastWorld?.mapLayout.mapId === mapId ? (lastWorld.warps?.warps ?? []) : [];
      const connections: Partial<Record<"north" | "south" | "east" | "west", number>> = {};
      if (lastWorld?.mapLayout.mapId === mapId && lastWorld.warps?.connections) {
        const c = lastWorld.warps.connections;
        if (c.north) connections.north = c.north.mapId;
        if (c.south) connections.south = c.south.mapId;
        if (c.west) connections.west = c.west.mapId;
        if (c.east) connections.east = c.east.mapId;
      }
      return { mapId, warps, connections };
    });
    mapGraph.build(inputs);
  };

  const runner = new CommandHarnessRunner({
    policy,
    executionContext,
    mapMemory,
    mapGraph,
    detector,
    maxSteps: Number.MAX_SAFE_INTEGER,
    maxLlmCalls: config.maxLlmCalls,
    stepDelayMs: config.loopStepDelayMs,
    readGameState,
    updateMapMemory,
    updateMapGraph,
    onStep: async (step, command, result) => {
      console.log(`[step ${step}] ${command.type}: ${result.status} — ${result.reason}${result.details ? ` (${result.details})` : ""}`);
    },
  });

  return {
    async run() {
      return runner.run();
    },
  };
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

function createDetector(config: Pick<HarnessConfig, "harnessMode">): Stage1Detector | FullGameDetector {
  return config.harnessMode === "full-game" ? new FullGameDetector() : new Stage1Detector();
}

function isLlmProvider(value: string | undefined): value is Extract<AiProvider, "openai"> {
  return value === "openai";
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

function isHarnessCommand(value: string): value is HarnessCommand {
  return value === "preflight" || value === "run" || value === "press";
}

interface MutableCliOptions {
  command?: HarnessCommand;
  help: boolean;
  runId?: string;
  pressButton?: string;
  pressFrames?: number;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
