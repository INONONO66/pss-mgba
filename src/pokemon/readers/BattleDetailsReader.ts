import { decodeBattleFlag, decodeBigEndianWord, decodeStatusCondition, decodeUnsignedByte } from "../decoders.js";
import { speciesName, typeName } from "../PokemonCatalog.js";
import type { BattleState, EnemyPokemon } from "../PokemonTypes.js";
import type { RamClient } from "../RamClient.js";
import { readRangeExact } from "../RamClient.js";
import { RED_BLUE_MEMORY_MAP } from "../memoryMap.js";
import { decodeMoveSlots } from "./PartyReader.js";

const map = RED_BLUE_MEMORY_MAP;

const ENEMY_OFFSETS = {
  species: 0,
  hp: 1,
  status: 4,
  type1: 5,
  type2: 6,
  moves: 8,
  level: 14,
  maxHp: 15,
  pp: 25,
} as const;

export async function readBattleDetails(client: RamClient): Promise<BattleState> {
  const battle = decodeBattleFlag(await client.read8(map.wIsInBattle));
  const inBattle = battle.kind !== "none";

  return {
    inBattle,
    type: battle.kind,
    ...(inBattle ? { enemy: await readEnemyPokemon(client) } : {}),
  };
}

async function readEnemyPokemon(client: RamClient): Promise<EnemyPokemon> {
  const bytes = await readRangeExact(client, map.wEnemyMon, map.BATTLEMON_STRUCT_LENGTH, "wEnemyMon");
  const speciesId = byteAt(bytes, ENEMY_OFFSETS.species, "enemy.species");

  return {
    speciesId,
    species: speciesName(speciesId),
    level: byteAt(bytes, ENEMY_OFFSETS.level, "enemy.level"),
    hp: wordAt(bytes, ENEMY_OFFSETS.hp, "enemy.hp"),
    maxHp: wordAt(bytes, ENEMY_OFFSETS.maxHp, "enemy.maxHp"),
    status: decodeStatusCondition(byteAt(bytes, ENEMY_OFFSETS.status, "enemy.status")),
    types: [
      typeName(byteAt(bytes, ENEMY_OFFSETS.type1, "enemy.type1")),
      typeName(byteAt(bytes, ENEMY_OFFSETS.type2, "enemy.type2")),
    ],
    moves: decodeMoveSlots(bytes, ENEMY_OFFSETS.moves, ENEMY_OFFSETS.pp),
  };
}

function byteAt(bytes: Uint8Array, index: number, fieldName: string): number {
  return decodeUnsignedByte(bytes[index], fieldName);
}

function wordAt(bytes: Uint8Array, index: number, fieldName: string): number {
  return decodeBigEndianWord(byteAt(bytes, index, `${fieldName}.high`), byteAt(bytes, index + 1, `${fieldName}.low`), fieldName);
}
