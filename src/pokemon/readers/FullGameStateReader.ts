import { readBattleDetails } from "./BattleDetailsReader.js";
import { readBagItems } from "./InventoryReader.js";
import { readPartyDetail } from "./PartyReader.js";
import { readMapInfo, readPlayerInfo } from "./PlayerReader.js";
import { readDialogState, readStoryFlags } from "./ProgressReader.js";
import type { BadgeProgress, FullGameState, MenuTextState, PlayerFacing, PokemonCoordinates } from "../PokemonTypes.js";
import type { RamClient } from "../RamClient.js";

export interface FullGameStateInput {
  readonly client: RamClient;
  readonly coordinates: PokemonCoordinates;
  readonly playerFacing: PlayerFacing;
  readonly badges: BadgeProgress;
  readonly menuText: MenuTextState;
}

export async function readFullGameState(input: FullGameStateInput): Promise<FullGameState> {
  const { client, coordinates, playerFacing, badges, menuText } = input;
  const [player, map, party, bag, battle, dialog, flags] = await Promise.all([
    readPlayerInfo(client, coordinates, playerFacing, badges),
    readMapInfo(client, coordinates.mapId),
    readPartyDetail(client),
    readBagItems(client),
    readBattleDetails(client),
    readDialogState(client, menuText.screenText),
    readStoryFlags(client, badges),
  ]);

  return {
    player,
    map,
    party,
    bag,
    battle,
    dialog,
    flags,
    menuText,
  };
}
