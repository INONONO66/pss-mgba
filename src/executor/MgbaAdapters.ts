import type { MgbaButton } from "../mgba/MgbaTypes.js";
import type { GameMode } from "../control/CommandTypes.js";
import type { GameMode as WorldGameMode } from "../game/GameWorld.js";
import type { NavigateController, NavigateWorldReader, NavigateMapSource } from "./NavigateExecutor.js";
import type { InteractController, InteractStateReader } from "./InteractExecutor.js";
import type { DialogController, DialogStateReader } from "./DialogExecutor.js";
import type { BattleController } from "./BattleExecutor.js";
import { RED_BLUE_MEMORY_MAP } from "../game/memoryMap.js";
import { RWY_ADDRESS, WINDOW_HIDDEN_Y, NAMING_SCREEN_MARKERS } from "../game/GameWorld.js";
import { decodeGen1Text } from "../game/TextCodec.js";

const map = RED_BLUE_MEMORY_MAP;

// Gen 1 overlay menus (YES/NO, BUY/SELL) render a sub-box at row 7, col 14
// of the tilemap. The top-left corner tile 0x79 (┌) at that offset is the
// most reliable signal that a choice menu is on screen.
const CHOICE_BOX_CORNER_OFFSET = 7 * 20 + 14;
const TILE_BOX_TOP_LEFT = 0x79;

async function isDialogActiveFromRam(ram: RamReader): Promise<boolean> {
  const windowY = await ram.read8(RWY_ADDRESS);
  return windowY < WINDOW_HIDDEN_Y;
}

const FACING_MAP: Record<number, string> = {
  0: "down",
  4: "up",
  8: "left",
  12: "right",
};

export interface RamReader {
  holdButton(button: MgbaButton, frames: number): Promise<void>;
  read8(address: number): Promise<number>;
  readRange(address: number, length: number): Promise<Uint8Array>;
}

export interface WalkabilitySource {
  walkabilityGrid(
    mapId: number
  ): { grid: boolean[][]; width: number; height: number } | undefined;
}

export type UnifiedController = NavigateController &
  InteractController &
  DialogController &
  BattleController;

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

export function createNavigateMapSource(
  source: WalkabilitySource,
  warpSource?: WarpSource
): NavigateMapSource {
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
    readTileAt(offset: number) {
      return ram.read8(map.wTileMap + offset);
    },
    isDialogActive() {
      return isDialogActiveFromRam(ram);
    },
    async isWindowVisible() {
      const windowY = await ram.read8(RWY_ADDRESS);
      return windowY < WINDOW_HIDDEN_Y;
    },
    async isInBattle() {
      return (await ram.read8(map.wIsInBattle)) !== 0;
    },
    async isChoiceActive() {
      // YES/NO and other overlay menus render a sub-box above the main
      // dialog area (rows 12-17). Detect the top-left corner tile (0x79 ┌)
      // at row 7, col 14 (tilemap offset 154).
      const cornerTile = await ram.read8(map.wTileMap + CHOICE_BOX_CORNER_OFFSET);
      return cornerTile === TILE_BOX_TOP_LEFT;
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
