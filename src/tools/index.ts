import type { AgentTools } from "@minpeter/pss-runtime";
import { env } from "../env";
import { MGBA_BUTTONS, MgbaHttpClient } from "../mgba-http";
import {
  createSupervisedMgbaClient,
  type SupervisorIntervention,
} from "../supervisor";
import type { MgbaToolContext } from "./context";
import { createHoldManyTool, createHoldTool } from "./hold";
import { createReleaseTool } from "./release";
import { createScreenshotTool } from "./screenshot";
import { createStatusTool } from "./status";
import { createTapManyTool, createTapTool } from "./tap";

export interface MgbaControlPlaneOptions {
  client?: MgbaHttpClient;
  includeObservationTools?: boolean;
  onSupervisorIntervention?: (intervention: SupervisorIntervention) => void;
}

export function createMgbaControlPlane({
  client = new MgbaHttpClient({ baseUrl: env.MGBA_HTTP_BASE_URL }),
  includeObservationTools = true,
  onSupervisorIntervention,
}: MgbaControlPlaneOptions = {}): AgentTools {
  return createMgbaTools(
    {
      client: createSupervisedMgbaClient(client, {
        onIntervention: onSupervisorIntervention,
      }),
    },
    { includeObservationTools }
  );
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
    mgba_tap: createTapTool(context),
    mgba_tap_many: createTapManyTool(context),
    mgba_hold: createHoldTool(context),
    mgba_hold_many: createHoldManyTool(context),
    mgba_release: createReleaseTool(context),
  } satisfies AgentTools;
}

function describeMgbaTools(): string {
  return [
    "You can control the already-running game through button tools.",
    "Game progress must never be reset or reloaded by the model; reset and ROM-loading tools are intentionally not exposed.",
    `Available buttons: ${MGBA_BUTTONS.join(", ")}.`,
    "Use mgba_tap for A/B/Start/Select interactions, dialogue, menus, and facing/very small directional nudges. Use mgba_hold for movement. A local supervisor enforces deterministic timing: single directional movement uses duration 12, non-directional taps use duration 6, and unsafe long movement chains are shortened to one supervised tile before the next observation.",
    "The runner usually injects current screenshot/status into each turn, so mgba_screenshot and mgba_status are available but not recommended unless the injected observation is stale, ambiguous, or insufficient.",
  ].join("\n");
}
