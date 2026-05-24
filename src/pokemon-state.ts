import type { MgbaHttpClient } from "./mgba-http";

export type PokemonStateReadStatus = "available" | "unavailable";
export type PokemonDirection = "down" | "up" | "left" | "right" | "unknown";

export interface PokemonStateObservation {
  battle: boolean;
  battleResult: number | null;
  battleType: number | null;
  dialogueLike: boolean | "visual-fallback";
  direction: PokemonDirection;
  mapId: number | null;
  menuLike: boolean | "visual-fallback";
  position: {
    x: number | null;
    y: number | null;
  };
  readStatus: PokemonStateReadStatus;
}

const POKEMON_RED_ADDRESSES = {
  battleResult: 0xcf_0b,
  battleType: 0xd0_5a,
  isInBattle: 0xd0_57,
  mapId: 0xd3_5e,
  playerFacing: 0xc1_09,
  xCoord: 0xd3_62,
  yCoord: 0xd3_61,
} as const;

export async function readPokemonStateObservation(
  client: MgbaHttpClient,
  signal?: AbortSignal
): Promise<PokemonStateObservation> {
  try {
    const [
      mapId,
      yCoord,
      xCoord,
      facing,
      isInBattle,
      battleType,
      battleResult,
    ] = await Promise.all([
      client.read8(POKEMON_RED_ADDRESSES.mapId, signal),
      client.read8(POKEMON_RED_ADDRESSES.yCoord, signal),
      client.read8(POKEMON_RED_ADDRESSES.xCoord, signal),
      client.read8(POKEMON_RED_ADDRESSES.playerFacing, signal),
      client.read8(POKEMON_RED_ADDRESSES.isInBattle, signal),
      client.read8(POKEMON_RED_ADDRESSES.battleType, signal),
      client.read8(POKEMON_RED_ADDRESSES.battleResult, signal),
    ]);

    return {
      battle: isInBattle !== 0,
      battleResult,
      battleType,
      dialogueLike: "visual-fallback",
      direction: formatDirection(facing),
      mapId,
      menuLike: "visual-fallback",
      position: {
        x: xCoord,
        y: yCoord,
      },
      readStatus: "available",
    };
  } catch {
    return unavailablePokemonStateObservation();
  }
}

export function formatPokemonStateObservation(
  state: PokemonStateObservation
): string {
  return [
    `readStatus: ${state.readStatus}`,
    `mapId: ${formatNullableNumber(state.mapId)}`,
    `position: x=${formatNullableNumber(state.position.x)}, y=${formatNullableNumber(state.position.y)}`,
    `direction: ${state.direction}`,
    `battle: ${state.battle}`,
    `battleType: ${formatNullableNumber(state.battleType)}`,
    `battleResult: ${formatNullableNumber(state.battleResult)}`,
    `dialogueLike: ${state.dialogueLike}`,
    `menuLike: ${state.menuLike}`,
  ].join("\n");
}

function unavailablePokemonStateObservation(): PokemonStateObservation {
  return {
    battle: false,
    battleResult: null,
    battleType: null,
    dialogueLike: "visual-fallback",
    direction: "unknown",
    mapId: null,
    menuLike: "visual-fallback",
    position: {
      x: null,
      y: null,
    },
    readStatus: "unavailable",
  };
}

function formatDirection(value: number): PokemonDirection {
  if (value === 0) {
    return "down";
  }
  if (value === 4) {
    return "up";
  }
  if (value === 8) {
    return "left";
  }
  if (value === 12) {
    return "right";
  }
  return "unknown";
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "unknown" : String(value);
}
