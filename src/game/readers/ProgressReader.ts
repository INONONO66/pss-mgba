import { countSetBits, decodeUnsignedByte } from "../decoders.js";
import type { BadgeProgress, DialogState, StoryFlags } from "../PokemonTypes.js";
import type { RamClient } from "../RamClient.js";
import { readRangeExact } from "../RamClient.js";
import { RED_BLUE_MEMORY_MAP } from "../memoryMap.js";

const map = RED_BLUE_MEMORY_MAP;

export async function readStoryFlags(client: RamClient, badges: BadgeProgress): Promise<StoryFlags> {
  const [ownedFlags, seenFlags, eventBytes] = await Promise.all([
    readRangeExact(client, map.wPokedexOwned, map.POKEDEX_FLAG_BYTES, "wPokedexOwned"),
    readRangeExact(client, map.wPokedexSeen, map.POKEDEX_FLAG_BYTES, "wPokedexSeen"),
    readRangeExact(client, eventByteAddress(Math.min(map.EVENT_GOT_POKEDEX, map.EVENT_OAK_GOT_PARCEL, map.EVENT_GOT_OAKS_PARCEL)), 4, "wEventFlags.earlyStory")
  ]);

  return {
    hasPokedex: testEvent(eventBytes, map.EVENT_GOT_POKEDEX),
    hasOaksParcel: testEvent(eventBytes, map.EVENT_GOT_OAKS_PARCEL),
    deliveredOaksParcel: testEvent(eventBytes, map.EVENT_OAK_GOT_PARCEL),
    pokedexOwned: countSetBits(ownedFlags, 151),
    pokedexSeen: countSetBits(seenFlags, 151),
    badges,
  };
}

export async function readDialogState(client: RamClient, screenText = ""): Promise<DialogState> {
  const [textBoxId, letterPrintingDelayFlags, joyIgnore] = await Promise.all([
    client.read8(map.wTextBoxID),
    client.read8(map.wLetterPrintingDelayFlags),
    client.read8(map.wJoyIgnore),
  ]);

  const decodedTextBoxId = decodeUnsignedByte(textBoxId, "wTextBoxID");
  const decodedLetterFlags = decodeUnsignedByte(letterPrintingDelayFlags, "wLetterPrintingDelayFlags");
  const decodedJoyIgnore = decodeUnsignedByte(joyIgnore, "wJoyIgnore");

  return {
    active: decodedJoyIgnore !== 0 || (decodedTextBoxId !== 0 && screenText.trim().length > 0),
    textBoxId: decodedTextBoxId,
    letterPrintingDelayFlags: decodedLetterFlags,
    joyIgnore: decodedJoyIgnore,
  };
}

function eventByteAddress(eventId: number): number {
  return map.wEventFlags + Math.floor(eventId / 8);
}

function testEvent(bytesFromFirstEvent: Uint8Array, eventId: number): boolean {
  const firstEventByte = Math.floor(Math.min(map.EVENT_GOT_POKEDEX, map.EVENT_OAK_GOT_PARCEL, map.EVENT_GOT_OAKS_PARCEL) / 8);
  const byteIndex = Math.floor(eventId / 8) - firstEventByte;
  return (bytesFromFirstEvent[byteIndex] & (1 << (eventId % 8))) !== 0;
}
