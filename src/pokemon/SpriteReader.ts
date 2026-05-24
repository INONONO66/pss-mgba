import type { MgbaHttpClient } from "../mgba/MgbaHttpClient.js";
import { RED_BLUE_MEMORY_MAP } from "./memoryMap.js";

type RamClient = Pick<MgbaHttpClient, "read8" | "readRange">;

const map = RED_BLUE_MEMORY_MAP;

export type FacingDirection = "down" | "up" | "left" | "right" | "unknown";

export interface SpriteState {
  readonly slot: number;
  readonly isPlayer: boolean;
  readonly pictureId: number;
  readonly movementStatus: number;
  readonly yScreen: number;
  readonly xScreen: number;
  readonly facing: FacingDirection;
  readonly mapY: number;
  readonly mapX: number;
  readonly inGrass: boolean;
  readonly onScreen: boolean;
  readonly movementType: "stationary" | "random" | "scripted";
}

export interface SpriteSnapshot {
  readonly player: SpriteState | undefined;
  readonly npcs: readonly SpriteState[];
  readonly spriteCount: number;
}

function decodeFacing(raw: number): FacingDirection {
  switch (raw) {
    case 0x00: return "down";
    case 0x04: return "up";
    case 0x08: return "left";
    case 0x0c: return "right";
    default: return "unknown";
  }
}

function decodeMovementType(movementByte: number): SpriteState["movementType"] {
  if (movementByte === 0xff) return "stationary";
  if (movementByte === 0xfe) return "random";
  return "scripted";
}

export async function readSprites(client: RamClient): Promise<SpriteSnapshot> {
  const [data1, data2, spriteCount] = await Promise.all([
    client.readRange(map.wSpriteStateData1, map.SPRITE_COUNT * map.SPRITE_STRUCT_SIZE),
    client.readRange(map.wSpriteStateData2, map.SPRITE_COUNT * map.SPRITE_STRUCT_SIZE),
    client.read8(map.wNumberOfSprites),
  ]);

  const sprites: SpriteState[] = [];

  for (let i = 0; i < map.SPRITE_COUNT; i++) {
    const off = i * map.SPRITE_STRUCT_SIZE;
    const pictureId = data1[off];
    if (pictureId === 0 && i !== 0) continue;
    if (i === 0 && data1[off + 4] === 0 && data1[off + 6] === 0) continue;

    sprites.push({
      slot: i,
      isPlayer: i === 0,
      pictureId,
      movementStatus: data1[off + 1],
      yScreen: data1[off + 4],
      xScreen: data1[off + 6],
      facing: decodeFacing(data1[off + 9]),
      mapY: data2[off + 4] - 4,
      mapX: data2[off + 5] - 4,
      inGrass: data2[off + 7] === 0x80,
      onScreen: data1[off + 2] !== 0xff,
      movementType: decodeMovementType(data2[off + 6]),
    });
  }

  return {
    player: sprites.find((s) => s.isPlayer),
    npcs: sprites.filter((s) => !s.isPlayer),
    spriteCount,
  };
}
