import type { AgentTools } from "@minpeter/pss-runtime";
import { env } from "../env";
import { MGBA_BUTTONS, MgbaHttpClient } from "../mgba-http";
import type { MgbaToolContext } from "./context";
import { createHoldManyTool, createHoldTool } from "./hold";
import { createLoadRomTool } from "./load-rom";
import { createReleaseTool } from "./release";
import { createResetTool } from "./reset";
import { createScreenshotTool } from "./screenshot";
import { createStatusTool } from "./status";
import { createTapManyTool, createTapTool } from "./tap";

export interface MgbaControlPlaneOptions {
  client?: MgbaHttpClient;
  includeObservationTools?: boolean;
  romPath?: string;
}

export function createMgbaControlPlane({
  client = new MgbaHttpClient({ baseUrl: env.MGBA_HTTP_BASE_URL }),
  includeObservationTools = true,
  romPath = env.MGBA_ROM_PATH,
}: MgbaControlPlaneOptions = {}): AgentTools {
  return createMgbaTools({ client, romPath }, { includeObservationTools });
}

export function describeMgbaControlPlane(): string {
  return describeMgbaTools();
}

function createMgbaTools(
  context: MgbaToolContext,
  { includeObservationTools }: { includeObservationTools: boolean }
): AgentTools {
  return {
    ...(includeObservationTools
      ? {
          mgba_status: createStatusTool(context),
          mgba_screenshot: createScreenshotTool(context),
        }
      : {}),
    mgba_load_rom: createLoadRomTool(context),
    mgba_tap: createTapTool(context),
    mgba_tap_many: createTapManyTool(context),
    mgba_hold: createHoldTool(context),
    mgba_hold_many: createHoldManyTool(context),
    mgba_release: createReleaseTool(context),
    mgba_reset: createResetTool(context),
  } satisfies AgentTools;
}

function describeMgbaTools(): string {
  return [
    "You can control mGBA through mGBA-http tools.",
    "Use MGBA_ROM_PATH via mgba_load_rom when a ROM needs to be loaded.",
    `Available buttons: ${MGBA_BUTTONS.join(", ")}.`,
    "Prefer mgba_tap for discrete actions and mgba_hold for movement across multiple frames.",
    "Observation may be injected by the runner. If mgba_screenshot/mgba_status are not available, rely on the provided screenshot/status input and choose exactly one useful action.",
  ].join("\n");
}
