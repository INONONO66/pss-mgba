import type { HarnessConfig } from "../cli/config.js";
import { HarnessError } from "../shared/errors.js";
import { wCurMap, wXCoord, wYCoord } from "../game/memoryMap.js";
import type { HarnessErrorCode } from "../shared/types.js";
import { MgbaHttpClient } from "./MgbaHttpClient.js";

type MgbaPreflightStatus = "pass" | "fail" | "warn";

type MgbaPreflightCheckName =
  | "config"
  | "current_frame"
  | "ram_wCurMap"
  | "ram_wYCoord"
  | "ram_wXCoord"
  | "screenshot"
  | "button_tap";

interface MgbaPreflightCheck {
  readonly name: MgbaPreflightCheckName;
  readonly status: MgbaPreflightStatus;
  readonly message: string;
  readonly guidance?: string;
  readonly errorCode?: HarnessErrorCode;
  readonly details?: Record<string, unknown>;
}

export interface MgbaPreflightReport {
  readonly ok: boolean;
  readonly checks: MgbaPreflightCheck[];
}

export interface MgbaPreflightClient {
  currentFrame(): Promise<number>;
  read8(address: number): Promise<number>;
  screenshot(path?: string): Promise<string>;
  tapButton(button: "B", frames: number): Promise<void>;
}

interface RunMgbaPreflightOptions {
  readonly config: HarnessConfig;
  readonly client?: MgbaPreflightClient;
}

interface CheckDefinition {
  readonly name: MgbaPreflightCheckName;
  readonly run: () => Promise<MgbaPreflightCheck>;
}

const ramChecks = [
  { name: "ram_wCurMap", symbol: "wCurMap", address: wCurMap },
  { name: "ram_wYCoord", symbol: "wYCoord", address: wYCoord },
  { name: "ram_wXCoord", symbol: "wXCoord", address: wXCoord }
] as const;

export async function runMgbaPreflight(options: RunMgbaPreflightOptions): Promise<MgbaPreflightReport> {
  const { config } = options;
  const client = options.client ?? new MgbaHttpClient({ baseUrl: config.mgbaHttpBaseUrl });
  const checks: MgbaPreflightCheck[] = [];

  const definitions: CheckDefinition[] = [
    { name: "config", run: () => checkConfig(config) },
    { name: "current_frame", run: () => checkCurrentFrame(client) },
    ...ramChecks.map((ramCheck): CheckDefinition => ({
      name: ramCheck.name,
      run: () => checkRamByte(client, ramCheck.symbol, ramCheck.address)
    })),
    { name: "screenshot", run: () => checkScreenshot(client) },
    { name: "button_tap", run: () => checkButtonTap(client, config.defaultTapFrames) }
  ];

  for (const definition of definitions) {
    checks.push(await runCheck(definition));
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks
  };
}

async function runCheck(definition: CheckDefinition): Promise<MgbaPreflightCheck> {
  try {
    return await definition.run();
  } catch (error) {
    return failureFromError(definition.name, error);
  }
}

async function checkConfig(config: HarnessConfig): Promise<MgbaPreflightCheck> {
  const details: Record<string, unknown> = {
    mgbaHttpBaseUrl: config.mgbaHttpBaseUrl,
    pokemonVersion: config.pokemonVersion,
    defaultTapFrames: config.defaultTapFrames,
    hasPokemonRomPath: config.pokemonRomPath !== undefined
  };

  if (config.pokemonRomPath === undefined) {
    return {
      name: "config",
      status: "warn",
      message: "POKEMON_ROM_PATH is not configured; preflight will not load or validate a ROM.",
      guidance: "Set POKEMON_ROM_PATH before live harness runs, then manually load the ROM in mGBA if needed.",
      errorCode: "ROM_NOT_LOADED_OR_INVALID",
      details
    };
  }

  return {
    name: "config",
    status: "pass",
    message: "Harness config is usable for mGBA preflight.",
    details
  };
}

async function checkCurrentFrame(client: MgbaPreflightClient): Promise<MgbaPreflightCheck> {
  const frame = await client.currentFrame();
  return {
    name: "current_frame",
    status: "pass",
    message: "mGBA current frame endpoint responded.",
    details: { frame }
  };
}

async function checkRamByte(client: MgbaPreflightClient, symbol: string, address: number): Promise<MgbaPreflightCheck> {
  const value = await client.read8(address);
  return {
    name: `ram_${symbol}` as MgbaPreflightCheckName,
    status: "pass",
    message: `${symbol} RAM byte is readable.`,
    details: { symbol, address, value }
  };
}

async function checkScreenshot(client: MgbaPreflightClient): Promise<MgbaPreflightCheck> {
  const path = await client.screenshot();
  return {
    name: "screenshot",
    status: "pass",
    message: "mGBA screenshot endpoint responded.",
    details: { path }
  };
}

async function checkButtonTap(client: MgbaPreflightClient, frames: number): Promise<MgbaPreflightCheck> {
  await client.tapButton("B", frames);
  return {
    name: "button_tap",
    status: "pass",
    message: "mGBA button tap endpoint accepted B input.",
    guidance: "If this fails live, compare the structured error endpoint with the installed mGBA-http button parameter shape.",
    details: { button: "B", frames }
  };
}

function failureFromError(name: MgbaPreflightCheckName, error: unknown): MgbaPreflightCheck {
  if (error instanceof HarnessError) {
    return {
      name,
      status: "fail",
      message: error.message,
      guidance: guidanceFor(name, error.code),
      errorCode: error.code,
      details: error.safeContext
    };
  }

  return {
    name,
    status: "fail",
    message: error instanceof Error ? error.message : "Preflight check failed with an unknown error.",
    guidance: guidanceFor(name, "MGBA_UNAVAILABLE")
  };
}

function guidanceFor(name: MgbaPreflightCheckName, code: HarnessErrorCode): string {
  if (code === "SCREENSHOT_FAILED") {
    return "Confirm mGBA-http screenshot support and that the configured screenshot directory is writable.";
  }

  if (code === "ROM_NOT_LOADED_OR_INVALID") {
    return "Set POKEMON_ROM_PATH and manually load a valid Pokemon Red or Blue ROM in mGBA before live runs.";
  }

  if (name === "button_tap") {
    return "Confirm the mGBA-http button tap endpoint is enabled and that mGBA loaded the mGBASocketServer.lua script.";
  }

  if (name.startsWith("ram_")) {
    return "Confirm a Pokemon Red or Blue ROM is loaded and mGBA-http memory read endpoints are available.";
  }

  return "Start mGBA manually with mGBA-http enabled and verify MGBA_HTTP_BASE_URL points to it.";
}
