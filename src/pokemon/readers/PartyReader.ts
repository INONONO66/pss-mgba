import { decodeBigEndian24, decodeBigEndianWord, decodePartyCount, decodeStatusCondition, decodeUnsignedByte } from "../decoders.js";
import { moveName, speciesName, typeName } from "../PokemonCatalog.js";
import type { MoveSlot, PartyDetail, PartyPokemon } from "../PokemonTypes.js";
import type { RamClient } from "../RamClient.js";
import { readRangeExact } from "../RamClient.js";
import { decodeGen1Name } from "../TextCodec.js";
import { RED_BLUE_MEMORY_MAP } from "../memoryMap.js";

const map = RED_BLUE_MEMORY_MAP;

const OFFSETS = {
  species: 0,
  hp: 1,
  status: 4,
  type1: 5,
  type2: 6,
  moves: 8,
  experience: 14,
  pp: 29,
  level: 33,
  maxHp: 34,
  attack: 36,
  defense: 38,
  speed: 40,
  special: 42,
} as const;

export async function readPartyDetail(client: RamClient): Promise<PartyDetail> {
  const count = decodePartyCount(await client.read8(map.wPartyCount));
  if (count === 0) return { count, members: [] };

  const [monBytes, nicknameBytes] = await Promise.all([
    readRangeExact(client, map.wPartyMons, map.PARTY_LENGTH * map.PARTYMON_STRUCT_LENGTH, "wPartyMons"),
    readRangeExact(client, map.wPartyMonNicks, map.PARTY_LENGTH * map.NAME_LENGTH, "wPartyMonNicks")
  ]);

  const members: PartyPokemon[] = [];
  for (let slot = 0; slot < count; slot++) {
    members.push(decodePartyPokemon(slot, monBytes, nicknameBytes));
  }

  return { count, members };
}

function decodePartyPokemon(slot: number, monBytes: Uint8Array, nicknameBytes: Uint8Array): PartyPokemon {
  const base = slot * map.PARTYMON_STRUCT_LENGTH;
  const nameBase = slot * map.NAME_LENGTH;
  const speciesId = byteAt(monBytes, base + OFFSETS.species, "party.species");
  const nickname = decodeGen1Name(nicknameBytes.slice(nameBase, nameBase + map.NAME_LENGTH)) || speciesName(speciesId);
  const moves = decodeMoveSlots(monBytes, base + OFFSETS.moves, base + OFFSETS.pp);

  return {
    slot,
    speciesId,
    species: speciesName(speciesId),
    nickname,
    level: byteAt(monBytes, base + OFFSETS.level, "party.level"),
    hp: wordAt(monBytes, base + OFFSETS.hp, "party.hp"),
    maxHp: wordAt(monBytes, base + OFFSETS.maxHp, "party.maxHp"),
    status: decodeStatusCondition(byteAt(monBytes, base + OFFSETS.status, "party.status")),
    types: [
      typeName(byteAt(monBytes, base + OFFSETS.type1, "party.type1")),
      typeName(byteAt(monBytes, base + OFFSETS.type2, "party.type2")),
    ],
    moves,
    stats: {
      attack: wordAt(monBytes, base + OFFSETS.attack, "party.attack"),
      defense: wordAt(monBytes, base + OFFSETS.defense, "party.defense"),
      speed: wordAt(monBytes, base + OFFSETS.speed, "party.speed"),
      special: wordAt(monBytes, base + OFFSETS.special, "party.special"),
    },
    experience: decodeBigEndian24(
      byteAt(monBytes, base + OFFSETS.experience, "party.exp.high"),
      byteAt(monBytes, base + OFFSETS.experience + 1, "party.exp.mid"),
      byteAt(monBytes, base + OFFSETS.experience + 2, "party.exp.low"),
      "party.experience"
    ),
  };
}

export function decodeMoveSlots(bytes: Uint8Array, moveOffset: number, ppOffset: number): MoveSlot[] {
  const moves: MoveSlot[] = [];
  for (let i = 0; i < 4; i++) {
    const id = byteAt(bytes, moveOffset + i, "move.id");
    if (id === 0) continue;
    const ppByte = byteAt(bytes, ppOffset + i, "move.pp");
    moves.push({
      id,
      name: moveName(id),
      pp: ppByte & 0x3f,
      ppUp: ppByte >> 6,
    });
  }
  return moves;
}

function byteAt(bytes: Uint8Array, index: number, fieldName: string): number {
  return decodeUnsignedByte(bytes[index], fieldName);
}

function wordAt(bytes: Uint8Array, index: number, fieldName: string): number {
  return decodeBigEndianWord(byteAt(bytes, index, `${fieldName}.high`), byteAt(bytes, index + 1, `${fieldName}.low`), fieldName);
}
