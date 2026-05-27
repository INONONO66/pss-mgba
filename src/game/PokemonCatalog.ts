import {
  GEN1_ITEM_NAMES,
  GEN1_MAPS,
  GEN1_MOVE_NAMES,
  GEN1_SPECIES_NAMES,
  GEN1_TYPE_NAMES,
  lookupName
} from "./data/Gen1Names.js";

export function speciesName(speciesId: number): string {
  return lookupName(GEN1_SPECIES_NAMES, speciesId, "Species");
}

export function moveName(moveId: number): string {
  return lookupName(GEN1_MOVE_NAMES, moveId, "Move");
}

export function itemName(itemId: number): string {
  return lookupName(GEN1_ITEM_NAMES, itemId, "Item");
}

export function typeName(typeId: number): string {
  return lookupName(GEN1_TYPE_NAMES, typeId, "Type");
}

export function mapName(mapId: number): string {
  return GEN1_MAPS[mapId]?.name ?? `Map #${mapId}`;
}


