import "dotenv/config";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { HeuristicPolicy } from "./ai/HeuristicPolicy.js";
import { LLMPolicy } from "./ai/LLMPolicy.js";
import { Controller } from "./control/Controller.js";
import type { MgbaButton } from "./mgba/MgbaTypes.js";
import { MGBA_BUTTONS } from "./mgba/MgbaTypes.js";
import { HarnessActionSchema } from "./control/ActionSchema.js";
import { loadConfig, type AiProvider, type HarnessConfig, type HarnessMode } from "./config.js";
import { EvidenceRecorder } from "./evidence/EvidenceRecorder.js";
import { formatDebugEvent } from "./evidence/EventFormatter.js";
import { redactSecrets } from "./evidence/redaction.js";
import { HarnessError } from "./errors.js";
import { HarnessRunner } from "./loop/HarnessRunner.js";
import { runMgbaSmokeWorkflow, type MgbaSmokeWorkflowDependencies } from "./loop/MgbaSmokeWorkflow.js";
import { MgbaHttpClient } from "./mgba/MgbaHttpClient.js";
import { runMgbaPreflight, type MgbaPreflightReport } from "./mgba/preflight.js";
import { PokemonStateReader } from "./pokemon/PokemonStateReader.js";
import { FullGameDetector } from "./pokemon/FullGameDetector.js";
import { Stage1Detector } from "./pokemon/Stage1Detector.js";
import { ScreenshotProcessor } from "./vision/ScreenshotProcessor.js";

type HarnessCommand = "snapshot" | "preflight" | "run" | "press" | "smoke";

export interface CliOptions {
  readonly command?: HarnessCommand;
  readonly dryRun: boolean;
  readonly help: boolean;
  readonly policy?: AiProvider;
  readonly mode?: HarnessMode;
  readonly vision: boolean;
  readonly maxSteps?: number;
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
  readonly createRunner?: (config: HarnessConfig, options: RunnerCommandOptions) => CliRunner;
  readonly runPreflight?: (config: HarnessConfig) => Promise<MgbaPreflightReport>;
  readonly executePress?: (config: HarnessConfig, action: unknown) => Promise<void>;
}

export interface CliRunner {
  snapshot(): Promise<unknown>;
  run(): Promise<{ readonly status: string }>;
}

interface RunnerCommandOptions {
  readonly maxSteps?: number;
  readonly debugEventSink?: (event: Parameters<typeof formatDebugEvent>[0]) => void;
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
    "  pnpm run harness snapshot [--dry-run] [--policy heuristic|openai] [--mode stage1|full-game] [--vision] [--max-steps N] [--run-id ID]",
    "  pnpm run harness preflight [--policy heuristic|openai] [--mode stage1|full-game] [--vision] [--run-id ID]",
    "  pnpm run harness run [--policy heuristic|openai] [--mode stage1|full-game] [--vision] [--max-steps N] [--run-id ID]",
    "  pnpm run harness press BUTTON [--frames N] [--run-id ID]",
    "  pnpm run smoke:mgba",
    "",
    "Commands:",
    "  snapshot   Record one runner snapshot, or print config only with --dry-run.",
    "  preflight  Run mGBA preflight against the manually started service and loaded ROM state.",
    "  run        Start the selected harness loop. Defaults to Stage 1.",
    "  press      Send one safe Game Boy button press for smoke checks.",
    "  smoke      Opt-in mGBA smoke: preflight, snapshot, press B, snapshot.",
    "",
    "Options:",
    "  --vision       Enable LLM image input for this command when the selected provider/model supports it.",
    "  --max-steps N  Optional step cap override. Omit it and LOOP_MAX_STEPS for no step cap.",
    "  --run-id ID    Optional HARNESS_RUN_ID override for evidence paths. Omit it to generate a run id.",
    "",
    "Safe buttons: A, B, Start, Select, Up, Down, Left, Right"
  ].join("\n");
}

export function parseCliArgs(args: readonly string[]): ParsedOptionResult {
  const errors: string[] = [];
  const options: MutableCliOptions = { dryRun: false, help: false, vision: false };
  const rest: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--policy":
        options.policy = parsePolicy(args[++index], errors);
        break;
      case "--mode":
        options.mode = parseMode(args[++index], errors);
        break;
      case "--vision":
        options.vision = true;
        break;
      case "--max-steps":
        options.maxSteps = parsePositiveInteger(args[++index], "--max-steps", errors);
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
      case "snapshot":
        return await handleSnapshot(parsed.options, io, factories);
      case "preflight":
        return await handlePreflight(parsed.options, io, factories);
      case "run":
        return await handleRun(parsed.options, io, factories);
      case "press":
        return await handlePress(parsed.options, io, factories);
      case "smoke":
        return await handleSmoke(parsed.options, io);
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

function loadCommandConfig(options: CliOptions, factories: CliFactories, dryRun = false): HarnessConfig {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.policy !== undefined) {
    env.AI_PROVIDER = options.policy;
  }
  if (options.mode !== undefined) {
    env.HARNESS_MODE = options.mode;
  }
  if (options.maxSteps !== undefined) {
    env.LOOP_MAX_STEPS = String(options.maxSteps);
  }
  if (options.runId !== undefined) {
    env.HARNESS_RUN_ID = options.runId;
  }
  if (options.vision) {
    env.LLM_VISION_ENABLED = "true";
  }
  if (dryRun && !hasProviderApiKey(env)) {
    env.AI_PROVIDER = "heuristic";
  }

  return (factories.loadConfig ?? loadConfig)(env);
}

async function handleSnapshot(options: CliOptions, io: CliIo, factories: CliFactories): Promise<number> {
  const config = loadCommandConfig(options, factories, options.dryRun);
  if (options.dryRun) {
    io.stdout("Snapshot dry run succeeded. No mGBA or OpenAI client was constructed.");
    io.stdout(formatConfigSummary(config));
    return 0;
  }

  const runner = (factories.createRunner ?? createRunner)(config, { maxSteps: options.maxSteps });
  const snapshot = await runner.snapshot();
  io.stdout(redactSecrets({ command: "snapshot", snapshot }));
  return 0;
}

async function handlePreflight(options: CliOptions, io: CliIo, factories: CliFactories): Promise<number> {
  const config = loadCommandConfig(options, factories);
  const report = await (factories.runPreflight ?? ((loadedConfig) => runMgbaPreflight({ config: loadedConfig })))(config);
  io.stdout(formatPreflightReport(report));
  return report.ok ? 0 : 1;
}

async function handleRun(options: CliOptions, io: CliIo, factories: CliFactories): Promise<number> {
  const config = loadCommandConfig(options, factories);
  const runner = (factories.createRunner ?? createRunner)(config, {
    maxSteps: options.maxSteps,
    debugEventSink: inlineDebugLogsEnabled(process.env.HARNESS_INLINE_DEBUG_LOGS)
      ? (event) => {
        const line = formatDebugEvent(event);
        if (line !== undefined) {
          io.stderr(line);
        }
      }
      : undefined
  });
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

async function handleSmoke(options: CliOptions, io: CliIo): Promise<number> {
  if (process.env.RUN_MGBA_INTEGRATION !== "1" || process.env.MGBA_HTTP_BASE_URL === undefined || process.env.MGBA_HTTP_BASE_URL.trim().length === 0) {
    io.stdout("mGBA smoke skipped. Set RUN_MGBA_INTEGRATION=1 and MGBA_HTTP_BASE_URL to contact an already running mGBA-http service.");
    return 0;
  }

  const config = loadCommandConfig({ ...options, runId: options.runId ?? `smoke-mgba-${Date.now()}` }, {});
  const dependencies = createSmokeDependencies(config);
  const result = await runMgbaSmokeWorkflow({ config, dependencies });
  io.stdout(redactSecrets({ command: "smoke:mgba", result, evidenceDir: `${config.evidenceDir}/${config.harnessRunId}` }));
  return result.status === "completed" ? 0 : 1;
}

function createSmokeDependencies(config: HarnessConfig): MgbaSmokeWorkflowDependencies {
  const evidence = new EvidenceRecorder({ evidenceDir: config.evidenceDir, runId: config.harnessRunId });
  const client = new MgbaHttpClient({ baseUrl: config.mgbaHttpBaseUrl, screenshotDir: evidence.paths.rawScreenshotsDir });
  const visionProcessor = config.llmVisionEnabled ? createVisionProcessor(config, evidence.paths.visionDir) : undefined;
  const controller = new Controller({
    client,
    defaultTapFrames: config.defaultTapFrames,
    defaultHoldFrames: config.defaultHoldFrames
  });
  const runner = new HarnessRunner({
    config,
    client,
    stateReader: new PokemonStateReader({ client, version: config.pokemonVersion }),
    policy: new HeuristicPolicy(),
    controller,
    evidence,
    detector: createDetector(config),
    visionProcessor,
    budgets: { maxSteps: 1 }
  });

  return {
    startEvidence: (startConfig) => evidence.startRun(startConfig),
    runPreflight: () => runMgbaPreflight({ config, client }),
    snapshot: () => runner.snapshot(),
    press: (action) => controller.execute(action),
    recordAction: (action) => evidence.recordAction(action),
    recordError: (error) => evidence.recordError(error),
    finishEvidence: (status, result) => evidence.finishRun(status, result)
  };
}

function createRunner(config: HarnessConfig, options: RunnerCommandOptions): CliRunner {
  const evidence = new EvidenceRecorder({ evidenceDir: config.evidenceDir, runId: config.harnessRunId });
  const client = new MgbaHttpClient({ baseUrl: config.mgbaHttpBaseUrl, screenshotDir: evidence.paths.rawScreenshotsDir });
  const heuristicPolicy = new HeuristicPolicy();
  const policy = isLlmProvider(config.aiProvider)
    ? LLMPolicy.fromConfig(config, heuristicPolicy)
    : heuristicPolicy;
  const visionProcessor = config.llmVisionEnabled ? createVisionProcessor(config, evidence.paths.visionDir) : undefined;

  return new HarnessRunner({
    config,
    client,
    stateReader: new PokemonStateReader({ client, version: config.pokemonVersion }),
    policy,
    controller: new Controller({
      client,
      defaultTapFrames: config.defaultTapFrames,
      defaultHoldFrames: config.defaultHoldFrames
    }),
    evidence,
    detector: createDetector(config),
    visionProcessor,
    budgets: { maxSteps: options.maxSteps },
    debugEventSink: options.debugEventSink
  });
}

function inlineDebugLogsEnabled(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  return !new Set(["0", "false", "no", "off"]).has(value.trim().toLowerCase());
}

function createVisionProcessor(config: HarnessConfig, outputDir: string): ScreenshotProcessor {
  return new ScreenshotProcessor({
    outputDir,
    cropLeft: config.llmVisionCropLeft,
    cropTop: config.llmVisionCropTop,
    cropWidth: config.llmVisionCropWidth,
    cropHeight: config.llmVisionCropHeight,
    maxWidth: config.llmVisionMaxWidth,
    maxHeight: config.llmVisionMaxHeight,
    format: config.llmVisionFormat,
    quality: config.llmVisionQuality,
    detail: config.llmVisionDetail
  });
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

function formatConfigSummary(config: HarnessConfig): string {
  return redactSecrets({
    mgbaHttpBaseUrl: config.mgbaHttpBaseUrl,
    pokemonVersion: config.pokemonVersion,
    harnessMode: config.harnessMode,
    hasPokemonRomPath: config.pokemonRomPath !== undefined,
    evidenceDir: config.evidenceDir,
    harnessRunId: config.harnessRunId,
    logLevel: config.logLevel,
    loopMaxSteps: config.loopMaxSteps,
    loopStepDelayMs: config.loopStepDelayMs,
    maxLlmCalls: config.maxLlmCalls,
    defaultTapFrames: config.defaultTapFrames,
    defaultHoldFrames: config.defaultHoldFrames,
    aiProvider: config.aiProvider,
    llmVisionEnabled: config.llmVisionEnabled,
    ...(config.llmVisionEnabled ? {
      llmVisionMaxImages: config.llmVisionMaxImages,
      llmVisionCropLeft: config.llmVisionCropLeft,
      llmVisionCropTop: config.llmVisionCropTop,
      llmVisionCropWidth: config.llmVisionCropWidth,
      llmVisionCropHeight: config.llmVisionCropHeight,
      llmVisionMaxWidth: config.llmVisionMaxWidth,
      llmVisionMaxHeight: config.llmVisionMaxHeight,
      llmVisionFormat: config.llmVisionFormat,
      llmVisionQuality: config.llmVisionQuality,
      llmVisionDetail: config.llmVisionDetail
    } : {}),
    ...(config.aiProvider === "openai" ? {
      openaiBaseUrl: config.openaiBaseUrl,
      hasOpenaiApiKey: config.openaiApiKey !== undefined,
      openaiModel: config.openaiModel,
      openaiTemperature: config.openaiTemperature
    } : {})
  });
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

function parsePolicy(value: string | undefined, errors: string[]): AiProvider | undefined {
  if (value === "heuristic" || value === "openai") {
    return value;
  }
  errors.push("--policy must be heuristic or openai");
  return undefined;
}

function parseMode(value: string | undefined, errors: string[]): HarnessMode | undefined {
  if (value === "stage1" || value === "full-game") {
    return value;
  }
  errors.push("--mode must be stage1 or full-game");
  return undefined;
}

function createDetector(config: Pick<HarnessConfig, "harnessMode">): Stage1Detector | FullGameDetector {
  return config.harnessMode === "full-game" ? new FullGameDetector() : new Stage1Detector();
}

function isLlmProvider(value: string | undefined): value is Extract<AiProvider, "openai"> {
  return value === "openai";
}

function hasProviderApiKey(env: NodeJS.ProcessEnv): boolean {
  if (env.AI_PROVIDER === "openai") {
    return env.OPENAI_API_KEY !== undefined;
  }
  return true;
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
  return value === "snapshot" || value === "preflight" || value === "run" || value === "press" || value === "smoke";
}

interface MutableCliOptions {
  command?: HarnessCommand;
  dryRun: boolean;
  help: boolean;
  policy?: AiProvider;
  mode?: HarnessMode;
  vision: boolean;
  maxSteps?: number;
  runId?: string;
  pressButton?: string;
  pressFrames?: number;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
