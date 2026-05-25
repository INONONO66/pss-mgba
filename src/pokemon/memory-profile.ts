import { readFileSync } from "node:fs";
export interface MemoryProfile {
  readonly constants: Readonly<Record<string, number>>;
  readonly description?: string;
  readonly id: string;
  readonly memoryMap: Readonly<Record<string, number>>;
  readonly name: string;
}

export const REQUIRED_RED_BLUE_CONSTANTS = ["HALL_OF_FAME_MAP_ID"] as const;

export type RequiredRedBlueConstant =
  (typeof REQUIRED_RED_BLUE_CONSTANTS)[number];

export const REQUIRED_RED_BLUE_MEMORY_SYMBOLS = [
  "wIsInBattle",
  "wBattleType",
  "wBattleMonHP",
  "wEnemyMonHP",
  "wBattleResult",
  "wCurrentMenuItem",
  "wTileMap",
  "wTileMapLength",
  "wNamingScreenNameLength",
  "wNamingScreenSubmitName",
  "wNamingScreenType",
  "wSpritePlayerStateData1FacingDirection",
  "wTextBoxID",
  "wPlayerName",
  "NAME_LENGTH",
  "wPartyCount",
  "wPartySpecies",
  "wPartyMons",
  "PARTY_LENGTH",
  "PARTYMON_STRUCT_LENGTH",
  "wPartyMon1HP",
  "wPartyMon1MaxHP",
  "wPartyMonOT",
  "wPartyMonNicks",
  "wPokedexOwned",
  "wPokedexSeen",
  "POKEDEX_FLAG_BYTES",
  "wNumBagItems",
  "wBagItems",
  "wNumBoxItems",
  "wBoxItems",
  "BAG_ITEM_CAPACITY",
  "wPlayerMoney",
  "wRivalName",
  "wObtainedBadges",
  "wCurMap",
  "wTextProgress",
  "wYCoord",
  "wXCoord",
  "wYBlockCoord",
  "wXBlockCoord",
  "wLetterPrintingDelayFlags",
  "wCurMapTileset",
  "wCurMapHeight",
  "wCurMapWidth",
  "wCurMapDataPtr",
  "wCurMapConnections",
  "wNorthConnection",
  "wSouthConnection",
  "wWestConnection",
  "wEastConnection",
  "CONNECTION_SIZE",
  "wOverworldMap",
  "wOverworldMapMaxSize",
  "wSpriteStateData1",
  "wSpriteStateData2",
  "SPRITE_COUNT",
  "SPRITE_STRUCT_SIZE",
  "wNumberOfWarps",
  "wWarpEntries",
  "WARP_ENTRY_SIZE",
  "wTileInFrontOfPlayer",
  "wTilePlayerStandingOn",
  "wGrassRate",
  "wWalkCounter",
  "wJoyIgnore",
  "wNumberOfSprites",
  "wEventFlags",
  "EVENT_GOT_POKEDEX",
  "EVENT_OAK_GOT_PARCEL",
  "EVENT_GOT_OAKS_PARCEL",
  "wPlayTimeHours",
  "wPlayTimeMaxed",
  "wPlayTimeMinutes",
  "wPlayTimeSeconds",
  "wPlayTimeFrames",
  "wEnemyMon",
  "wEnemyMonSpecies",
  "wEnemyMonLevel",
  "wEnemyMonStatus",
  "wEnemyMonType1",
  "wEnemyMonType2",
  "wEnemyMonMoves",
  "wEnemyMonMaxHP",
  "wEnemyMonPP",
  "BATTLEMON_STRUCT_LENGTH",
  "wTilesetBank",
  "wTilesetCollisionPtr",
  "wTilesetGrassTile",
] as const;

export type RequiredRedBlueMemorySymbol =
  (typeof REQUIRED_RED_BLUE_MEMORY_SYMBOLS)[number];

export function loadMemoryProfile(profileUrl: URL): MemoryProfile {
  return validateMemoryProfile(
    JSON.parse(readFileSync(profileUrl, "utf8")),
    profileUrl.pathname
  );
}

export function validateMemoryProfile(
  value: unknown,
  source = "memory profile"
): MemoryProfile {
  if (!isRecord(value)) {
    throw new Error(`${source} must be a JSON object`);
  }

  const id = requiredString(value.id, "id", source);
  const name = requiredString(value.name, "name", source);
  const description = optionalString(value.description, "description", source);
  const memoryMap = requiredNumberMap(value.memoryMap, "memoryMap", source);
  const constants = requiredNumberMap(value.constants, "constants", source);

  return Object.freeze({
    id,
    name,
    ...(description === undefined ? {} : { description }),
    memoryMap: Object.freeze({ ...memoryMap }),
    constants: Object.freeze({ ...constants }),
  });
}

export function assertRequiredMemorySymbols(
  profile: Pick<MemoryProfile, "memoryMap">,
  requiredSymbols: readonly string[],
  source = "memory profile"
): void {
  assertRequiredNumberMapKeys(
    profile.memoryMap,
    requiredSymbols,
    "memory symbols",
    source
  );
}

export function assertRequiredProfileConstants(
  profile: Pick<MemoryProfile, "constants">,
  requiredConstants: readonly string[],
  source = "memory profile"
): void {
  assertRequiredNumberMapKeys(
    profile.constants,
    requiredConstants,
    "constants",
    source
  );
}

function assertRequiredNumberMapKeys(
  values: Readonly<Record<string, number>>,
  requiredKeys: readonly string[],
  label: string,
  source: string
): void {
  const missing = requiredKeys.filter((key) => values[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`${source} is missing ${label}: ${missing.join(", ")}`);
  }
}

function requiredString(value: unknown, field: string, source: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${source}.${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(
  value: unknown,
  field: string,
  source: string
): string | undefined {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `${source}.${field} must be a non-empty string when present`
    );
  }
  return value;
}

function requiredNumberMap(
  value: unknown,
  field: string,
  source: string
): Record<string, number> {
  if (!isRecord(value)) {
    throw new Error(`${source}.${field} must be an object of numeric values`);
  }

  const entries = Object.entries(value).map(([key, raw]) => {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
      throw new Error(
        `${source}.${field}.${key} must be a non-negative integer`
      );
    }
    return [key, raw] as const;
  });

  return Object.fromEntries(entries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
