import type { UserMessageContentPart } from "@minpeter/pss-runtime";
import type { MgbaHttpClient, MgbaStatus } from "./mgba-http";
import {
  formatPokemonStateObservation,
  type PokemonStateObservation,
  readPokemonStateObservation,
} from "./pokemon-state";
import { readOptimizedGameBoyScreenshotBase64 } from "./screenshot-image";
import { formatStuckMemory, type StuckMemorySnapshot } from "./stuck-memory";
import { createScreenshotPath } from "./tools/screenshot";

export type ObservedAgentInput = readonly UserMessageContentPart[];

export interface MgbaObservation {
  screenshot: {
    data: string;
    mediaType: "image/png";
    path: string;
  };
  state?: PokemonStateObservation;
  status: MgbaStatus;
}

export async function captureMgbaObservation(
  client: MgbaHttpClient,
  signal?: AbortSignal
): Promise<MgbaObservation> {
  const screenshotPath = await createScreenshotPath();
  const [status, state] = await Promise.all([
    client.status(signal),
    readPokemonStateObservation(client, signal),
    client.screenshot(screenshotPath, signal),
  ]);
  const data = await readOptimizedGameBoyScreenshotBase64(screenshotPath, {
    overlayGrid: true,
  });

  return {
    screenshot: {
      data,
      mediaType: "image/png",
      path: screenshotPath,
    },
    state,
    status,
  };
}

export function createObservedInput({
  observation,
  recentActions = [],
  stuckMemory,
  text,
}: {
  observation: MgbaObservation;
  recentActions?: readonly string[];
  stuckMemory?: StuckMemorySnapshot;
  text: string;
}): ObservedAgentInput {
  return [
    {
      text: `${text}\n\nCurrent mGBA status:\n${formatStatus(observation.status)}${formatState(observation.state)}${formatRecentActions(recentActions)}${formatStuckMemory(stuckMemory)}\n\nCurrent screenshot: attached image below. Red grid lines are movement guide lines marking 16x16 Game Boy movement-cell boundaries. Treat the red grid as movement guide lines. First distinguish blocked cells, open walkable cells, and interactable-looking objects. In indoor scenes, solid black areas/borders/void, walls, furniture, and counters are blocked; visible floor tiles are walkable unless occupied. However, if a black/dark tile looks like a doorway, carpet, threshold, stairs, mat, path marker, or other movement-guiding feature, approach or test it once as a possible transition/exit. Then either move through open floor to explore unseen areas or face an object and press A to interact. Avoid repeating recent actions that did not visibly change progress.`,
      type: "text",
    },
    {
      image: `data:${observation.screenshot.mediaType};base64,${observation.screenshot.data}`,
      mediaType: observation.screenshot.mediaType,
      type: "image",
    },
  ] satisfies ObservedAgentInput;
}

export function formatStatus(status: MgbaStatus): string {
  const activeButtons = status.activeButtons.join(", ") || "none";
  return [
    `frame: ${status.frame ?? "unknown"}`,
    `game: ${[status.gameTitle, status.gameCode].filter(Boolean).join(" ") || "unknown"}`,
    `active buttons: ${activeButtons}`,
  ].join("\n");
}

function formatRecentActions(recentActions: readonly string[]): string {
  if (recentActions.length === 0) {
    return "";
  }

  return `\nrecent actions to avoid repeating blindly:\n${recentActions.map((action) => `- ${action}`).join("\n")}`;
}

function formatState(state: PokemonStateObservation | undefined): string {
  if (!state) {
    return "";
  }

  return `\n\nCurrent compact Pokémon state:\n${formatPokemonStateObservation(state)}`;
}
