import type { NavigateCommand, CommandResult } from "../control/CommandTypes.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";
import { findPath, type Position } from "./Pathfinder.js";

export interface NavigateController {
  pressButton(button: MgbaButton, frames?: number): Promise<void>;
}

export interface NavigateWorldReader {
  readPosition(): Promise<{ mapId: number; y: number; x: number }>;
  readWalkCounter(): Promise<number>;
  isInBattle(): Promise<boolean>;
  isDialogActive(): Promise<boolean>;
}

export interface NavigateMapSource {
  walkabilityGrid(mapId: number): { grid: boolean[][]; width: number; height: number } | undefined;
  warpPositions?(mapId: number): ReadonlyArray<{ y: number; x: number }>;
  npcAt?(mapId: number, y: number, x: number): { slot: number; movementType: string } | undefined;
  refreshObstacles?(mapId: number): Promise<void>;
}

interface WorldPosition extends Position {
  mapId: number;
}

const WALK_POLL_COUNT = 10;
const WALK_POLL_MS = 50;
const MAX_STEP_RETRIES = 3;
const MAX_NPC_REPLANS = 3;

function directionButton(from: Position, to: Position): MgbaButton {
  if (to.y < from.y) {
    return "Up";
  }
  if (to.y > from.y) {
    return "Down";
  }
  if (to.x < from.x) {
    return "Left";
  }
  return "Right";
}

function samePosition(a: Position, b: Position): boolean {
  return a.y === b.y && a.x === b.x;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStep(
  worldReader: NavigateWorldReader,
  start: WorldPosition,
): Promise<WorldPosition | undefined> {
  for (let poll = 0; poll < WALK_POLL_COUNT; poll += 1) {
    await sleep(WALK_POLL_MS);
    const position = await worldReader.readPosition();
    if (position.mapId !== start.mapId || position.y !== start.y || position.x !== start.x) {
      return position;
    }
  }

  return;
}

async function interruptResult(
  worldReader: NavigateWorldReader,
  expectedMapId: number,
  currentMapId: number,
): Promise<CommandResult | undefined> {
  if (await worldReader.isInBattle()) {
    return { status: "interrupted", reason: "battle_started" };
  }

  if (await worldReader.isDialogActive()) {
    return { status: "interrupted", reason: "dialog_opened" };
  }

  if (currentMapId !== expectedMapId) {
    return { status: "interrupted", reason: "map_changed" };
  }

  return;
}

interface NavigationGoal {
  original: Position;
  pathTarget: Position;
  isWarp: boolean;
  isWalkable: boolean;
}

function resolveNavigationGoal(
  command: NavigateCommand,
  map: { grid: boolean[][]; width: number; height: number },
  warps: readonly Position[],
): NavigationGoal {
  const original = { y: command.y, x: command.x };
  const isWarp = isBoundaryWarp(original, map.width, map.height) || isListedWarp(original, warps);
  const isWalkable = isWalkableTile(map.grid, original, map.width, map.height);
  const pathTarget = (isWarp && !isWalkable)
    ? findAdjacentWalkable(map.grid, original, map.width, map.height) ?? original
    : original;

  return { original, pathTarget, isWarp, isWalkable };
}

export async function executeNavigate(
  command: NavigateCommand,
  controller: NavigateController,
  worldReader: NavigateWorldReader,
  mapSource: NavigateMapSource,
): Promise<CommandResult> {
  let current = await worldReader.readPosition();
  const map = mapSource.walkabilityGrid(current.mapId);

  if (map === undefined) {
    return { status: "failed", reason: "no_map" };
  }

  const mapId = current.mapId;
  const warps = mapSource.warpPositions?.(mapId) ?? [];

  const goal = resolveNavigationGoal(command, map, warps);

  const pathResult = findPath(
    map.grid,
    { y: current.y, x: current.x },
    goal.pathTarget,
    map.width,
    map.height,
  );

  if (pathResult.status === "no_path" && samePosition({ y: current.y, x: current.x }, pathResult.reachedPosition)) {
    return { status: "failed", reason: "no_path" };
  }

  const walkPathResult = await walkPathWithNpcReplans(
    pathResult.path,
    current,
    goal.pathTarget,
    controller,
    worldReader,
    mapSource,
    mapId,
  );
  if (walkPathResult.commandResult !== undefined) {
    return walkPathResult.commandResult;
  }
  current = walkPathResult.position;

  if (goal.isWarp && !goal.isWalkable && isAdjacent(current, goal.original)) {
    const pushResult = await tryPushIntoGoal(current, goal.original, controller, worldReader, mapId, warps, map.width, map.height);
    if (pushResult !== undefined) {
      return pushResult;
    }
  }

  if (goal.isWarp && samePosition(current, goal.original)) {
    const exitResult = await tryStepOffEdgeWarp(current, map.width, map.height, controller, worldReader, mapId);
    if (exitResult !== undefined) {
      return exitResult;
    }
  }

  if (pathResult.status === "partial") {
    const pushResult = await tryPushIntoGoal(current, goal.original, controller, worldReader, mapId, warps, map.width, map.height);
    if (pushResult !== undefined) {
      return pushResult;
    }

    return {
      status: "partial",
      reason: "reached",
      details: `Reached (${pathResult.reachedPosition.x},${pathResult.reachedPosition.y}), target in unexplored area`,
    };
  }

  return { status: "success", reason: "arrived" };
}

interface StepResult {
  position: WorldPosition;
  blocked: boolean;
  interrupt?: CommandResult;
}

interface WalkPathResult {
  position: WorldPosition;
  commandResult?: CommandResult;
}

async function walkPathWithNpcReplans(
  path: Position[],
  start: WorldPosition,
  goal: Position,
  controller: NavigateController,
  worldReader: NavigateWorldReader,
  mapSource: NavigateMapSource,
  mapId: number,
): Promise<WalkPathResult> {
  let current = start;
  let remainingReplans = MAX_NPC_REPLANS;
  let currentPath = path;
  let pathIndex = 0;

  while (pathIndex < currentPath.length) {
    const next = currentPath[pathIndex];
    const stepResult = await walkOneStep(current, next, controller, worldReader, mapId);
    if (stepResult.interrupt !== undefined) {
      return { position: stepResult.position, commandResult: stepResult.interrupt };
    }

    if (stepResult.blocked) {
      const replan = await replanAfterRandomNpcBlock(mapSource, mapId, next, current, goal, remainingReplans);
      if (replan !== undefined) {
        remainingReplans -= 1;
        currentPath = replan;
        pathIndex = 0;
        continue;
      }

      return { position: current, commandResult: { status: "failed", reason: "blocked_by_npc" } };
    }

    current = stepResult.position;
    pathIndex += 1;
  }

  return { position: current };
}

async function replanAfterRandomNpcBlock(
  mapSource: NavigateMapSource,
  mapId: number,
  blockedTile: Position,
  current: WorldPosition,
  goal: Position,
  remainingReplans: number,
): Promise<Position[] | undefined> {
  const npc = mapSource.npcAt?.(mapId, blockedTile.y, blockedTile.x);
  if (npc?.movementType !== "random" || remainingReplans <= 0) {
    return;
  }

  await sleep(500);
  await mapSource.refreshObstacles?.(mapId);

  const refreshedMap = mapSource.walkabilityGrid(mapId);
  if (refreshedMap === undefined) {
    return;
  }

  const replan = findPath(
    refreshedMap.grid,
    { y: current.y, x: current.x },
    goal,
    refreshedMap.width,
    refreshedMap.height,
  );

  return replan.status === "no_path" ? undefined : replan.path;
}

async function walkOneStep(
  current: WorldPosition,
  next: Position,
  controller: NavigateController,
  worldReader: NavigateWorldReader,
  expectedMapId: number,
): Promise<StepResult> {
  for (let attempt = 0; attempt < MAX_STEP_RETRIES; attempt += 1) {
    const button = directionButton(current, next);
    await controller.pressButton(button, 5);
    const moved = await waitForStep(worldReader, current);

    if (moved !== undefined) {
      const interrupt = await interruptResult(worldReader, expectedMapId, moved.mapId);
      if (interrupt !== undefined) {
        return { position: moved, blocked: false, interrupt };
      }
      return { position: moved, blocked: false };
    }

    await controller.pressButton(directionButton(current, next), 30);
  }

  return { position: current, blocked: true };
}

async function tryPushIntoGoal(
  current: WorldPosition,
  goal: Position,
  controller: NavigateController,
  worldReader: NavigateWorldReader,
  expectedMapId: number,
  warps: readonly Position[],
  width: number,
  height: number,
): Promise<CommandResult | undefined> {
  if (!isAdjacent(current, goal)) {
    return;
  }
  if (!isWarpTarget(goal, warps, width, height)) {
    return;
  }

  const button = directionButton(current, goal);
  await controller.pressButton(button, 5);
  const moved = await waitForStep(worldReader, current);

  if (moved === undefined) {
    return;
  }

  const interrupt = await interruptResult(worldReader, expectedMapId, moved.mapId);
  const warpResult = warpSuccessOnMapChange(interrupt);
  if (warpResult !== undefined) {
    return warpResult;
  }

  return { status: "success", reason: "arrived" };
}

async function tryStepOffEdgeWarp(
  current: WorldPosition,
  width: number,
  height: number,
  controller: NavigateController,
  worldReader: NavigateWorldReader,
  expectedMapId: number,
): Promise<CommandResult | undefined> {
  const target = edgeExitTarget(current, width, height);
  if (target === undefined) {
    return;
  }

  const button = directionButton(current, target);
  await controller.pressButton(button, 5);
  const moved = await waitForStep(worldReader, current);
  if (moved === undefined) {
    return;
  }

  const interrupt = await interruptResult(worldReader, expectedMapId, moved.mapId);
  const warpResult = warpSuccessOnMapChange(interrupt);
  if (warpResult !== undefined) {
    return warpResult;
  }

  return { status: "success", reason: "arrived" };
}

function edgeExitTarget(pos: Position, width: number, height: number): Position | undefined {
  if (pos.y === height - 1) {
    return { y: pos.y + 1, x: pos.x };
  }
  if (pos.y === 0) {
    return { y: pos.y - 1, x: pos.x };
  }
  if (pos.x === width - 1) {
    return { y: pos.y, x: pos.x + 1 };
  }
  if (pos.x === 0) {
    return { y: pos.y, x: pos.x - 1 };
  }
  return;
}

function isBoundaryWarp(goal: Position, width: number, height: number): boolean {
  return goal.y === height || goal.y === -1 || goal.x === width || goal.x === -1;
}

function isListedWarp(goal: Position, warps: readonly Position[]): boolean {
  return warps.some((w) => w.y === goal.y && w.x === goal.x);
}

function isWarpTarget(goal: Position, warps: readonly Position[], width: number, height: number): boolean {
  return isBoundaryWarp(goal, width, height) || isListedWarp(goal, warps);
}

function isWalkableTile(grid: boolean[][], goal: Position, width: number, height: number): boolean {
  if (goal.y < 0 || goal.y >= height || goal.x < 0 || goal.x >= width) {
    return false;
  }
  return grid[goal.y]?.[goal.x] === true;
}

function warpSuccessOnMapChange(interrupt: CommandResult | undefined): CommandResult | undefined {
  if (interrupt === undefined) {
    return;
  }
  if (interrupt.reason === "map_changed") {
    return { status: "success", reason: "warped" };
  }
  return interrupt;
}

function findAdjacentWalkable(grid: boolean[][], target: Position, width: number, height: number): Position | undefined {
  for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ny = target.y + dy;
    const nx = target.x + dx;
    if (ny >= 0 && ny < height && nx >= 0 && nx < width && grid[ny]?.[nx] === true) {
      return { y: ny, x: nx };
    }
  }
  return;
}

function isAdjacent(a: Position, b: Position): boolean {
  const dy = Math.abs(a.y - b.y);
  const dx = Math.abs(a.x - b.x);
  return (dy === 1 && dx === 0) || (dy === 0 && dx === 1);
}
