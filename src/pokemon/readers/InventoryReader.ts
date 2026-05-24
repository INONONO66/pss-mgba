import { decodeUnsignedByte } from "../decoders.js";
import { itemName } from "../PokemonCatalog.js";
import type { BagItem } from "../PokemonTypes.js";
import type { RamClient } from "../RamClient.js";
import { readRangeExact } from "../RamClient.js";
import { RED_BLUE_MEMORY_MAP } from "../memoryMap.js";

const map = RED_BLUE_MEMORY_MAP;
const END_OF_LIST = 0xff;

export async function readBagItems(client: RamClient): Promise<BagItem[]> {
  const count = Math.min(decodeUnsignedByte(await client.read8(map.wNumBagItems), "wNumBagItems"), map.BAG_ITEM_CAPACITY);
  if (count === 0) return [];

  const bytes = await readRangeExact(client, map.wBagItems, map.BAG_ITEM_CAPACITY * 2 + 1, "wBagItems");
  const items: BagItem[] = [];

  for (let slot = 0; slot < count; slot++) {
    const offset = slot * 2;
    const id = decodeUnsignedByte(bytes[offset], "bag.itemId");
    if (id === 0 || id === END_OF_LIST) break;
    items.push({
      id,
      name: itemName(id),
      quantity: decodeUnsignedByte(bytes[offset + 1], "bag.quantity"),
    });
  }

  return items;
}
