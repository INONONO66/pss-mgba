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

const FACING_MAP: Record<number, string> = {
  0x00: "down",
  0x04: "up",
  0x08: "left",
  0x0c: "right",
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
    async readWalkCounter() {
      return ram.read8(map.wWalkCounter);
    },
    async isInBattle() {
      return (await ram.read8(map.wIsInBattle)) !== 0;
    },
    async isDialogActive() {
      const [joyIgnore, textBoxId] = await Promise.all([
        ram.read8(map.wJoyIgnore),
        ram.read8(map.wTextBoxID),
      ]);
      return joyIgnore !== 0 || textBoxId !== 0;
    },
  };
}

export function createNavigateMapSource(source: WalkabilitySource): NavigateMapSource {
  return {
    walkabilityGrid(mapId) {
      return source.walkabilityGrid(mapId) ?? undefined;
    },
  };
}

export function createInteractStateReader(ram: RamReader): InteractStateReader {
  return {
    async readFacingDirection() {
      const raw = await ram.read8(map.wSpritePlayerStateData1FacingDirection);
      return FACING_MAP[raw] ?? "down";
    },
    async isDialogActive() {
      const [joyIgnore, textBoxId] = await Promise.all([
        ram.read8(map.wJoyIgnore),
        ram.read8(map.wTextBoxID),
      ]);
      return joyIgnore !== 0 || textBoxId !== 0;
    },
  };
}

export function createDialogStateReader(ram: RamReader): DialogStateReader {
  return {
    async readTextBoxId() {
      return ram.read8(map.wTextBoxID);
    },
    async readCurrentMenuItem() {
      return ram.read8(map.wCurrentMenuItem);
    },
    async readScreenText() {
      const bytes = await ram.readRange(map.wTileMap, map.wTileMapLength);
      return decodeGen1Text(bytes);
    },
    async isDialogActive() {
      const [joyIgnore, textBoxId] = await Promise.all([
        ram.read8(map.wJoyIgnore),
        ram.read8(map.wTextBoxID),
      ]);
      return joyIgnore !== 0 || textBoxId !== 0;
    },
    async isChoiceActive() {
      const textBoxId = await ram.read8(map.wTextBoxID);
      return textBoxId === 0x0d;
    },
    async isNamingScreenActive() {
      const namingScreenType = await ram.read8(map.wNamingScreenType);
      if (namingScreenType === 0) return false;
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
  }
}
