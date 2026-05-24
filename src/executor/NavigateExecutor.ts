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
}

interface WorldPosition extends Position {
  mapId: number;
}

const WALK_POLL_COUNT = 10;
const WALK_POLL_MS = 50;
const MAX_STEP_RETRIES = 3;

function directionButton(from: Position, to: Position): MgbaButton {
  if (to.y < from.y) return "Up";
  if (to.y > from.y) return "Down";
  if (to.x < from.x) return "Left";
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

  return undefined;
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

  return undefined;
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

  const goal = { y: command.y, x: command.x };
  const pathResult = findPath(
    map.grid,
    { y: current.y, x: current.x },
    goal,
    map.width,
    map.height,
  );

  if (pathResult.status === "no_path" && samePosition({ y: current.y, x: current.x }, pathResult.reachedPosition)) {
    return { status: "failed", reason: "no_path" };
  }

  for (const next of pathResult.path) {
    const stepResult = await walkOneStep(current, next, controller, worldReader, mapId);
    if (stepResult.interrupt !== undefined) return stepResult.interrupt;
    if (stepResult.blocked) return { status: "failed", reason: "blocked_by_npc" };
    current = stepResult.position;
  }

  if (pathResult.status === "partial") {
    const pushResult = await tryPushIntoGoal(current, goal, controller, worldReader, mapId);
    if (pushResult !== undefined) return pushResult;

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
      if (interrupt !== undefined) return { position: moved, blocked: false, interrupt };
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
): Promise<CommandResult | undefined> {
  if (!isAdjacent(current, goal)) return undefined;

  const button = directionButton(current, goal);
  await controller.pressButton(button, 5);
  const moved = await waitForStep(worldReader, current);

  if (moved === undefined) return undefined;

  const interrupt = await interruptResult(worldReader, expectedMapId, moved.mapId);
  if (interrupt !== undefined) return interrupt;

  return { status: "success", reason: "arrived" };
}

function isAdjacent(a: Position, b: Position): boolean {
  const dy = Math.abs(a.y - b.y);
  const dx = Math.abs(a.x - b.x);
  return (dy === 1 && dx === 0) || (dy === 0 && dx === 1);
}
