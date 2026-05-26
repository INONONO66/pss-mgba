import type { MgbaButton } from "../mgba/MgbaTypes.js";
import type { GameMode } from "../control/CommandTypes.js";
import type { GameMode as WorldGameMode } from "../pokemon/GameWorld.js";
import type { NavigateController, NavigateWorldReader, NavigateMapSource } from "./NavigateExecutor.js";
import type { InteractController, InteractStateReader } from "./InteractExecutor.js";
import type { DialogController, DialogStateReader } from "./DialogExecutor.js";
import type { BattleController } from "./BattleExecutor.js";
import { RED_BLUE_MEMORY_MAP } from "../pokemon/memoryMap.js";
import { decodeGen1Text } from "../pokemon/TextCodec.js";

const map = RED_BLUE_MEMORY_MAP;

const NAMING_SCREEN_MARKERS = ["lower case", "UPPER CASE", "ED Mr."];

async function isDialogActiveFromRam(ram: RamReader): Promise<boolean> {
  const [textBoxId, joyIgnore] = await Promise.all([
    ram.read8(map.wTextBoxID),
    ram.read8(map.wJoyIgnore),
  ]);
  return joyIgnore !== 0 || textBoxId !== 0;
}

const FACING_MAP: Record<number, string> = {
  0: "down",
  4: "up",
  8: "left",
  12: "right",
};

export interface RamReader {
  read8(address: number): Promise<number>;
  readRange(address: number, length: number): Promise<Uint8Array>;
  holdButton(button: MgbaButton, frames: number): Promise<void>;
}

export interface WalkabilitySource {
  walkabilityGrid(mapId: number): { grid: boolean[][]; width: number; height: number } | undefined;
}

export type UnifiedController = NavigateController & InteractController & DialogController & BattleController;

export function createUnifiedController(ram: RamReader): UnifiedController {
  return {
    async pressButton(button: MgbaButton, frames = 5) {
      await ram.holdButton(button, frames);
    },
  };
}

export function createNavigateWorldReader(ram: RamReader): NavigateWorldReader {
  return {
    async readPosition() {
      const [mapId, y, x] = await Promise.all([
        ram.read8(map.wCurMap),
        ram.read8(map.wYCoord),
        ram.read8(map.wXCoord),
      ]);
      return { mapId, y, x };
    },
    readWalkCounter() {
      return ram.read8(map.wWalkCounter);
    },
    async isInBattle() {
      return (await ram.read8(map.wIsInBattle)) !== 0;
    },
    isDialogActive() {
      return isDialogActiveFromRam(ram);
    },
  };
}

export interface WarpSource {
  warpPositions(mapId: number): ReadonlyArray<{ y: number; x: number }>;
}

export function createNavigateMapSource(source: WalkabilitySource, warpSource?: WarpSource): NavigateMapSource {
  return {
    walkabilityGrid(mapId) {
      return source.walkabilityGrid(mapId) ?? undefined;
    },
    warpPositions(mapId) {
      return warpSource?.warpPositions(mapId) ?? [];
    },
  };
}

export function createInteractStateReader(ram: RamReader): InteractStateReader {
  return {
    async readFacingDirection() {
      const raw = await ram.read8(map.wSpritePlayerStateData1FacingDirection);
      return FACING_MAP[raw] ?? "down";
    },
    isDialogActive() {
      return isDialogActiveFromRam(ram);
    },
  };
}

export function createDialogStateReader(ram: RamReader): DialogStateReader {
  return {
    readTextBoxId() {
      return ram.read8(map.wTextBoxID);
    },
    readCurrentMenuItem() {
      return ram.read8(map.wCurrentMenuItem);
    },
    async readScreenText() {
      const bytes = await ram.readRange(map.wTileMap, map.wTileMapLength);
      return decodeGen1Text(bytes);
    },
    isDialogActive() {
      return isDialogActiveFromRam(ram);
    },
    async isChoiceActive() {
      const textBoxId = await ram.read8(map.wTextBoxID);
      return textBoxId === 0x0d;
    },
    async isNamingScreenActive() {
      const namingScreenType = await ram.read8(map.wNamingScreenType);
      if (namingScreenType === 0) {
        return false;
      }
      const bytes = await ram.readRange(map.wTileMap, map.wTileMapLength);
      const text = decodeGen1Text(bytes);
      return NAMING_SCREEN_MARKERS.some((marker) => text.includes(marker));
    },
  };
}

export function toCommandGameMode(worldMode: WorldGameMode): GameMode {
  switch (worldMode) {
    case "battle":
      return "battle";
    case "dialog":
    case "naming":
      return "dialog";
    case "overworld":
    case "title":
    case "menu":
      return "overworld";
    default:
      return assertNever(worldMode);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled world mode: ${value}`);
}
