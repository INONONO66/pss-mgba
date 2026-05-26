import type { AgentTools, UserMessageContentPart } from "@minpeter/pss-runtime";
import { buildUserMessage } from "../ai/PromptBuilder.js";
import type { PolicyInput } from "../ai/PromptTypes.js";
import type { CommandHistoryEntry, CommandResult, GameMode } from "../control/CommandTypes.js";
import { AGENT_MEMORY_SECTIONS, type AgentMemoryEntry, type AgentMemoryFile } from "./AgentMemoryStore.js";
import type { MapGraph } from "../game/MapGraph.js";
import type { KnownNpc, MapMemory } from "../game/MapMemory.js";
import type { FullGameState } from "../game/PokemonTypes.js";

const HISTORY_LIMIT = 10;

export interface AgentObservationWarpInfo {
  readonly y: number;
  readonly x: number;
  readonly destWarpId: number;
  readonly destMapId: number;
  readonly destMapName: string;
}

export interface AgentObservationNpcInfo {
  readonly slot: number;
  readonly pictureId: number;
  readonly mapY: number;
  readonly mapX: number;
  readonly facing: string;
  readonly movementType: string;
}

export interface AgentObservationKnownNpcInfo {
  readonly slot: number;
  readonly pictureId: number;
  readonly mapY: number;
  readonly mapX: number;
  readonly movementType: string;
  readonly lastSeenTurn: number;
}

export interface AgentObservationState {
  readonly fullState: FullGameState;
  readonly mode: GameMode;
  readonly mapId: number;
  readonly playerY: number;
  readonly playerX: number;
  readonly facing: string;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly warps: readonly AgentObservationWarpInfo[];
  readonly npcs: readonly AgentObservationNpcInfo[];
}

export interface AgentObservationOptions {
  readonly adviserHint?: string;
  readonly availableTools?: AgentTools | Readonly<Record<string, unknown>> | readonly string[];
  readonly agentMemory?: AgentMemoryFile;
  readonly commandHistory?: readonly CommandHistoryEntry[];
  readonly detectorStatus?: unknown;
  readonly lastResult?: CommandResult;
  readonly objective?: string;
  readonly step?: number;
}

export function buildAgentObservation(
  state: AgentObservationState,
  mapMemory: MapMemory,
  mapGraph: MapGraph,
  opts: AgentObservationOptions = {}
): UserMessageContentPart[] {
  const commandHistory = opts.commandHistory?.slice(-HISTORY_LIMIT) ?? [];
  const lastResult = opts.lastResult ?? commandHistory.at(-1)?.result;
  const policyInput = buildPolicyInput(state, mapMemory, mapGraph, {
    ...opts,
    commandHistory,
    lastResult,
  });

  const text = [
    buildTurnSection(state, opts),
    buildMemorySection(opts.agentMemory),
    buildUserMessage(policyInput),
    buildAvailableToolsSection(opts.availableTools),
  ].filter((section) => section.trim().length > 0).join("\n\n");

  return [{ type: "text", text }];
}

function buildPolicyInput(
  state: AgentObservationState,
  mapMemory: MapMemory,
  mapGraph: MapGraph,
  opts: AgentObservationOptions
): PolicyInput {
  return {
    mode: state.mode,
    fullState: state.fullState,
    step: opts.step,
    lastResult: opts.lastResult,
    commandHistory: opts.commandHistory === undefined ? undefined : [...opts.commandHistory],
    detectorStatus: opts.detectorStatus,
    objective: opts.objective,
    adviserHint: opts.adviserHint,
    mapGraph: mapGraph.renderForLLM(state.mapId),
    currentMapFull: state.mode === "battle"
      ? undefined
      : mapMemory.renderFullMap(state.mapId, state.playerY, state.playerX, state.warps),
    microContext: state.mode === "battle"
      ? undefined
      : {
          position: { y: state.playerY, x: state.playerX },
          facing: state.facing,
          adjacent: getAdjacentTiles(state, mapMemory),
          warps: state.warps.map((warp) => ({
            y: warp.y,
            x: warp.x,
            destMapId: warp.destMapId,
            destMapName: warp.destMapName,
          })),
          npcs: state.npcs.map((npc) => ({
            slot: npc.slot,
            pictureId: npc.pictureId,
            mapY: npc.mapY,
            mapX: npc.mapX,
            facing: npc.facing,
            movementType: npc.movementType,
          })),
          knownNpcs: getKnownNpcs(mapMemory, state.mapId)
            .filter((npc) => !npc.onScreen)
            .slice(0, 8)
            .map((npc) => ({
              slot: npc.slot,
              pictureId: npc.pictureId,
              mapY: npc.mapY,
              mapX: npc.mapX,
              movementType: npc.movementType,
              lastSeenTurn: npc.lastSeenTurn,
            })),
        },
  };
}

function getKnownNpcs(mapMemory: MapMemory, mapId: number): readonly KnownNpc[] {
  const candidate = mapMemory as MapMemory & { getKnownNpcs?: (mapId: number) => readonly KnownNpc[] };
  return candidate.getKnownNpcs?.(mapId) ?? [];
}

const CHECKPOINT_LABELS: Record<string, string> = {
  initialObserved: "Observe starting area",
  starterAcquired: "Obtain starter Pokemon",
  rivalBattleEntered: "Enter Rival battle",
  rivalBattleExited: "Complete Rival battle",
  badgesObserved: "Observe first badge",
  allBadgesObtained: "Collect all 8 badges",
  hallOfFameObserved: "Reach Hall of Fame",
  hallOfFameCompleted: "Complete Hall of Fame",
  completed: "Game completed",
};

function buildTurnSection(state: AgentObservationState, opts: AgentObservationOptions): string {
  const lines = [
    "[AGENT TURN]",
    `Mode: ${state.mode}. Step ${opts.step ?? 0}.`,
    `Map: ${state.fullState.map.mapName} (map ${state.mapId}), size ${state.mapWidth}x${state.mapHeight}.`,
  ];

  if (opts.objective !== undefined && opts.objective.trim().length > 0) {
    lines.push(`Objective: ${opts.objective.trim()}`);
  }

  const milestones = buildMilestoneSection(opts.detectorStatus);
  if (milestones.length > 0) {
    lines.push(milestones);
  }

  return lines.join("\n");
}

function buildMilestoneSection(detectorStatus: unknown): string {
  if (detectorStatus === null || detectorStatus === undefined || typeof detectorStatus !== "object") {
    return "";
  }
  const checkpoints = (detectorStatus as Record<string, unknown>).checkpoints;
  if (checkpoints === null || checkpoints === undefined || typeof checkpoints !== "object") {
    return "";
  }

  const entries = Object.entries(checkpoints as Record<string, unknown>);
  const completed = entries
    .filter(([, value]) => value === true)
    .map(([key]) => CHECKPOINT_LABELS[key] ?? key);
  const next = entries.find(([key, value]) => value !== true && key !== "completed");

  const lines: string[] = [];
  if (next !== undefined) {
    lines.push(`Next milestone: ${CHECKPOINT_LABELS[next[0]] ?? next[0]}`);
  }
  if (completed.length > 0) {
    lines.push(`Completed: ${completed.join(", ")}`);
  }
  return lines.join("\n");
}

function buildAvailableToolsSection(tools: AgentObservationOptions["availableTools"]): string {
  const lines = formatAvailableTools(tools);
  return `[AVAILABLE TOOLS]\n${lines.join("\n")}`;
}

function buildMemorySection(memory: AgentMemoryFile | undefined): string {
  if (memory === undefined) {
    return "";
  }
  const sections = AGENT_MEMORY_SECTIONS
    .map((name) => {
      const entries = memory.sections[name];
      if (entries.length === 0) {
        return "";
      }
      return `${name}:\n${entries.map((entry: AgentMemoryEntry) => `- ${entry.content}`).join("\n")}`;
    })
    .filter((section) => section.length > 0);
  if (sections.length === 0) {
    return "";
  }
  return `[AGENT MEMORY]\n${sections.join("\n\n")}`;
}

function formatAvailableTools(tools: AgentObservationOptions["availableTools"]): string[] {
  if (tools === undefined) {
    return ["- none provided in observation options; use only tools exposed by the active session."];
  }

  if (Array.isArray(tools)) {
    return tools.length === 0 ? ["- none"] : tools.map((name) => `- ${name}`);
  }

  const entries = Object.entries(tools);
  if (entries.length === 0) {
    return ["- none"];
  }

  return entries.map(([name, value]) => {
    const description = getToolDescription(value);
    return description === undefined ? `- ${name}` : `- ${name}: ${description}`;
  });
}

function getToolDescription(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") {
    return;
  }

  const description = (value as { readonly description?: unknown }).description;
  if (typeof description !== "string" || description.trim().length === 0) {
    return;
  }

  return description.trim().replace(/\s+/g, " ");
}

function getAdjacentTiles(state: AgentObservationState, mapMemory: MapMemory): Record<string, string> {
  return {
    up: describeTile(state, mapMemory, state.playerY - 1, state.playerX),
    down: describeTile(state, mapMemory, state.playerY + 1, state.playerX),
    left: describeTile(state, mapMemory, state.playerY, state.playerX - 1),
    right: describeTile(state, mapMemory, state.playerY, state.playerX + 1),
  };
}

function describeTile(state: AgentObservationState, mapMemory: MapMemory, y: number, x: number): string {
  if (y < 0 || y >= state.mapHeight || x < 0 || x >= state.mapWidth) {
    return "unknown";
  }

  if (state.npcs.some((npc) => npc.mapY === y && npc.mapX === x)) {
    return "npc";
  }

  if (state.warps.some((warp) => warp.y === y && warp.x === x)) {
    return "warp";
  }

  const recorded = mapMemory.recordedTileAt?.(state.mapId, y, x);
  if (recorded === undefined) {
    const fallback = mapMemory.tileAt(state.mapId, y, x);
    if (fallback === undefined) {
      return "unknown";
    }
    return fallback === "wall" ? "wall" : "open";
  }

  const terrain = recorded.terrain ?? "wall";
  const features = recorded.features ?? [];

  if (terrain === "water") {
    return "water";
  }
  if (terrain === "grass") {
    return features.includes("cuttable") ? "grass(cuttable)" : "grass";
  }
  if (terrain === "wall") {
    if (features.includes("cuttable")) { return "cuttable_tree"; }
    if (features.includes("ledge")) { return "ledge"; }
    if (features.includes("counter")) { return "counter"; }
    return "wall";
  }

  if (features.includes("door")) { return "door"; }
  if (features.includes("warp")) { return "warp"; }
  return "open";
}
