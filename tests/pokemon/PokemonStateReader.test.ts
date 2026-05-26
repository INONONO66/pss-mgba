import { describe, expect, it } from "vitest";
import { HarnessError } from "../../src/shared/errors.js";
import { RED_BLUE_MEMORY_MAP } from "../../src/game/memoryMap.js";
import { PokemonStateReader } from "../../src/game/PokemonStateReader.js";

type ReadCall =
  | { method: "read8"; address: number }
  | { method: "read16"; address: number }
  | { method: "readRange"; address: number; length: number };

interface FakeRamClient {
  read8(address: number): Promise<number>;
  read16(address: number): Promise<number>;
  readRange(address: number, length: number): Promise<Uint8Array>;
  calls: ReadCall[];
}

const map = RED_BLUE_MEMORY_MAP;

function createFakeRamClient(options: {
  bytes?: Record<number, number>;
  ranges?: Record<string, readonly number[]>;
}): FakeRamClient {
  const calls: ReadCall[] = [];
  return {
    calls,
    async read8(address: number): Promise<number> {
      calls.push({ method: "read8", address });
      return options.bytes?.[address] ?? 0;
    },
    async read16(address: number): Promise<number> {
      calls.push({ method: "read16", address });
      return options.bytes?.[address] ?? 0;
    },
    async readRange(address: number, length: number): Promise<Uint8Array> {
      calls.push({ method: "readRange", address, length });
      return Uint8Array.from(options.ranges?.[rangeKey(address, length)] ?? Array.from({ length }, () => 0));
    }
  };
}

function rangeKey(address: number, length: number): string {
  return `${address}:${length}`;
}

function overworldRange(overrides: Record<number, number> = {}): number[] {
  return rangeBytes(map.wLetterPrintingDelayFlags, map.wXBlockCoord - map.wLetterPrintingDelayFlags + 1, {
    [map.wLetterPrintingDelayFlags]: 0x01,
    [map.wCurMap]: 0x02,
    [map.wYCoord]: 0x08,
    [map.wXCoord]: 0x0b,
    [map.wYBlockCoord]: 0x03,
    [map.wXBlockCoord]: 0x04,
    ...overrides
  });
}

function partyRange(partyCount: number, currentHp = 45, maxHp = 50): number[] {
  return rangeBytes(map.wPartyCount, map.wPartyMon1MaxHP - map.wPartyCount + 2, {
    [map.wPartyCount]: partyCount,
    [map.wPartyMon1HP]: currentHp >> 8,
    [map.wPartyMon1HP + 1]: currentHp & 0xff,
    [map.wPartyMon1MaxHP]: maxHp >> 8,
    [map.wPartyMon1MaxHP + 1]: maxHp & 0xff
  });
}

function rangeBytes(startAddress: number, length: number, valuesByAddress: Record<number, number>): number[] {
  return Array.from({ length }, (_, offset) => valuesByAddress[startAddress + offset] ?? 0);
}

function createStateClient(partyCount = 1, currentHp = 45, maxHp = 50): FakeRamClient {
  return createFakeRamClient({
    bytes: {
      [map.wBattleResult]: 0x00,
      [map.wCurrentMenuItem]: 0x02,
      [map.wObtainedBadges]: 0x85,
      [map.wSpritePlayerStateData1FacingDirection]: 0x0c,
      [map.wTextBoxID]: 0x00,
      [map.wLetterPrintingDelayFlags]: 0x01,
      [map.wNamingScreenNameLength]: 0x00,
      [map.wNamingScreenSubmitName]: 0x00,
      [map.wNamingScreenType]: 0x00
    },
    ranges: {
      [rangeKey(map.wEnemyMonHP, 2)]: [0x18, 0x00],
      [rangeKey(map.wBattleMonHP, 2)]: [0x2d, 0x00],
      [rangeKey(map.wIsInBattle, map.wBattleType - map.wIsInBattle + 1)]: [0x00, 0x00, 0x00, 0x00],
      [rangeKey(map.wLetterPrintingDelayFlags, map.wXBlockCoord - map.wLetterPrintingDelayFlags + 1)]: overworldRange(),
      [rangeKey(map.wPartyCount, map.wPartyMon1MaxHP - map.wPartyCount + 2)]: partyRange(partyCount, currentHp, maxHp),
      [rangeKey(map.wTileMap, map.wTileMapLength)]: tileMapBytes("Hello there! Welcome to the world of POKEMON!")
    }
  });
}

function tileMapBytes(text: string): number[] {
  const bytes = Array.from({ length: map.wTileMapLength }, () => 0x7f);
  Array.from(text).forEach((character, index) => {
    bytes[index] = encodeTile(character);
  });
  return bytes;
}

function encodeTile(character: string): number {
  if (character >= "A" && character <= "Z") {
    return 0x80 + character.charCodeAt(0) - "A".charCodeAt(0);
  }

  if (character >= "a" && character <= "z") {
    return 0xa0 + character.charCodeAt(0) - "a".charCodeAt(0);
  }

  switch (character) {
    case " ":
      return 0x7f;
    case "!":
      return 0xe7;
    case ".":
      return 0xe8;
    default:
      return 0x7f;
  }
}

describe("PokemonStateReader", () => {
  it("reads grouped RAM ranges and returns a validated overworld state with detector-compatible fields", async () => {
    const client = createStateClient();
    const reader = new PokemonStateReader({ client, version: "red" });

    await expect(reader.readState()).resolves.toMatchObject({
      battle: { kind: "none", raw: 0 },
      coordinates: { mapId: 2, y: 8, x: 11, yBlock: 3, xBlock: 4 },
      playerFacing: { raw: 0x0c, direction: "right" },
      party: { count: 1, firstPokemonHp: { current: 45, max: 50 } },
      menuText: {
        currentMenuItem: 2,
        textBoxId: 0,
        letterPrintingDelayFlags: 1,
        screenText: "Hello there! Welcome to the world of POKEMON!",
        screenTextKind: "oak_intro",
        namingScreenNameLength: 0,
        namingScreenSubmitName: 0,
        namingScreenType: 0
      },
      wIsInBattle: 0,
      wPartyCount: 1,
      wObtainedBadges: 0x85,
      badgeCount: 3,
      badgesObtained: [true, false, true, false, false, false, false, true],
      hallOfFameComplete: false,
      wCurMap: 2,
      wYCoord: 8,
      wXCoord: 11,
      wSpritePlayerStateData1FacingDirection: 0x0c,
      playerFacingDirection: "right",
      wCurrentMenuItem: 2,
      wNamingScreenNameLength: 0,
      wNamingScreenSubmitName: 0,
      wNamingScreenType: 0,
      wTextBoxID: 0,
      wLetterPrintingDelayFlags: 1,
      screenText: "Hello there! Welcome to the world of POKEMON!",
      screenTextKind: "oak_intro",
      partyCount: 1,
      mapId: 2,
      y: 8,
      x: 11,
      menuItem: 2,
      textBoxId: 0,
      letterDelayFlags: 1
    });

    expect(client.calls).toEqual(expect.arrayContaining([
      { method: "read8", address: map.wBattleResult },
      { method: "read8", address: map.wObtainedBadges },
      { method: "readRange", address: map.wEnemyMonHP, length: 2 },
      { method: "readRange", address: map.wBattleMonHP, length: 2 },
      { method: "readRange", address: map.wIsInBattle, length: map.wBattleType - map.wIsInBattle + 1 },
      { method: "readRange", address: map.wLetterPrintingDelayFlags, length: map.wXBlockCoord - map.wLetterPrintingDelayFlags + 1 },
      { method: "readRange", address: map.wPartyCount, length: map.wPartyMon1MaxHP - map.wPartyCount + 2 },
      { method: "readRange", address: map.wTileMap, length: map.wTileMapLength },
      { method: "read8", address: map.wSpritePlayerStateData1FacingDirection },
      { method: "read8", address: map.wCurrentMenuItem },
      { method: "read8", address: map.wTextBoxID },
      { method: "read8", address: map.wLetterPrintingDelayFlags },
      { method: "read8", address: map.wNamingScreenNameLength },
      { method: "read8", address: map.wNamingScreenSubmitName },
      { method: "read8", address: map.wNamingScreenType }
    ]));
    expect(client.calls).not.toContainEqual(expect.objectContaining({ method: "read16" }));
  });

  it("derives Hall of Fame completion from the observed map id without memory writes", async () => {
    const client = createStateClient();
    client.calls.length = 0;
    const reader = new PokemonStateReader({ client, version: "red" });
    client.readRange = async (address: number, length: number): Promise<Uint8Array> => {
      client.calls.push({ method: "readRange", address, length });
      if (address === map.wLetterPrintingDelayFlags) {
        return Uint8Array.from(overworldRange({ [map.wCurMap]: 0x76 }));
      }
      return Uint8Array.from(Array.from({ length }, () => 0));
    };

    await expect(reader.readState()).resolves.toMatchObject({ mapId: 0x76, hallOfFameComplete: true });
    expect(client.calls).not.toContainEqual(expect.objectContaining({ method: "read16" }));
  });

  it("treats party count 0 as no first Pokemon HP while party count 1 validates HP", async () => {
    const emptyPartyReader = new PokemonStateReader({ client: createStateClient(0, 99, 0), version: "blue" });
    await expect(emptyPartyReader.readPartyState()).resolves.toEqual({ count: 0 });

    const onePokemonReader = new PokemonStateReader({ client: createStateClient(1, 12, 20), version: "red" });
    await expect(onePokemonReader.readPartyState()).resolves.toEqual({
      count: 1,
      firstPokemonHp: { current: 12, max: 20 }
    });
  });

  it("keeps transient starter acquisition party count when HP bytes are not populated yet", async () => {
    const reader = new PokemonStateReader({ client: createStateClient(1, 0, 0), version: "red" });

    await expect(reader.readPartyState()).resolves.toEqual({ count: 1 });
  });

  it("decodes party HP as big-endian words from the Gen 1 party struct", async () => {
    const reader = new PokemonStateReader({ client: createStateClient(1, 19, 19), version: "red" });

    await expect(reader.readPartyState()).resolves.toEqual({
      count: 1,
      firstPokemonHp: { current: 19, max: 19 }
    });
  });

  it("throws INVALID_RAM_STATE when party HP exceeds max HP", async () => {
    const reader = new PokemonStateReader({ client: createStateClient(1, 51, 50), version: "red" });

    await expect(reader.readPartyState()).rejects.toMatchObject({ code: "INVALID_RAM_STATE" });
    await expect(reader.readPartyState()).rejects.toBeInstanceOf(HarnessError);
  });

  it("throws INVALID_RAM_STATE for unsupported battle flags", async () => {
    const client = createFakeRamClient({
      bytes: { [map.wBattleResult]: 0 },
      ranges: {
        [rangeKey(map.wEnemyMonHP, 2)]: [1, 0],
        [rangeKey(map.wBattleMonHP, 2)]: [1, 0],
        [rangeKey(map.wIsInBattle, map.wBattleType - map.wIsInBattle + 1)]: [3, 0, 0, 0]
      }
    });
    const reader = new PokemonStateReader({ client, version: "red" });

    await expect(reader.readBattleState()).rejects.toMatchObject({ code: "INVALID_RAM_STATE" });
  });

  it("throws INVALID_RAM_STATE for unsupported player facing values", async () => {
    const client = createFakeRamClient({
      bytes: { [map.wSpritePlayerStateData1FacingDirection]: 0x02 }
    });
    const reader = new PokemonStateReader({ client, version: "red" });

    await expect(reader.readPlayerFacingState()).rejects.toMatchObject({ code: "INVALID_RAM_STATE" });
  });

  it("rejects unsupported runtime versions", () => {
    const options = { client: createStateClient(), version: "yellow" } as unknown as ConstructorParameters<typeof PokemonStateReader>[0];

    expect(() => new PokemonStateReader(options)).toThrow(HarnessError);
    expect(() => new PokemonStateReader(options)).toThrow("only supports Pokemon Red and Blue");
  });

  it("reads full game state details through modular RAM readers", async () => {
    const client = createFakeRamClient({
      bytes: {
        [map.wCurrentMenuItem]: 0x01,
        [map.wTextBoxID]: 0x02,
        [map.wLetterPrintingDelayFlags]: 0x01,
        [map.wNamingScreenNameLength]: 0x00,
        [map.wNamingScreenSubmitName]: 0x00,
        [map.wNamingScreenType]: 0x00,
        [map.wSpritePlayerStateData1FacingDirection]: 0x00,
        [map.wObtainedBadges]: 0x01,
        [map.wCurMapTileset]: 0x00,
        [map.wCurMapHeight]: 0x09,
        [map.wCurMapWidth]: 0x0a,
        [map.wPartyCount]: 0x01,
        [map.wNumBagItems]: 0x02,
        [map.wIsInBattle]: 0x01,
        [map.wJoyIgnore]: 0xff,
      },
      ranges: {
        [rangeKey(map.wLetterPrintingDelayFlags, map.wXBlockCoord - map.wLetterPrintingDelayFlags + 1)]: overworldRange({ [map.wCurMap]: 0x00, [map.wYCoord]: 0x04, [map.wXCoord]: 0x05 }),
        [rangeKey(map.wTileMap, map.wTileMapLength)]: tileMapBytes("Hello!"),
        [rangeKey(map.wPlayerName, map.NAME_LENGTH)]: nameBytes("RED"),
        [rangeKey(map.wRivalName, map.NAME_LENGTH)]: nameBytes("BLUE"),
        [rangeKey(map.wPlayerMoney, 3)]: [0x12, 0x34, 0x56],
        [rangeKey(map.wPlayTimeHours, 5)]: [12, 0, 34, 56, 7],
        [rangeKey(map.wPartyMons, map.PARTY_LENGTH * map.PARTYMON_STRUCT_LENGTH)]: partyMonsBytes(),
        [rangeKey(map.wPartyMonNicks, map.PARTY_LENGTH * map.NAME_LENGTH)]: partyNickBytes("SPARKY"),
        [rangeKey(map.wBagItems, map.BAG_ITEM_CAPACITY * 2 + 1)]: bagBytes(),
        [rangeKey(map.wEnemyMon, map.BATTLEMON_STRUCT_LENGTH)]: enemyMonBytes(),
        [rangeKey(map.wPokedexOwned, map.POKEDEX_FLAG_BYTES)]: pokedexFlags(0b00000101),
        [rangeKey(map.wPokedexSeen, map.POKEDEX_FLAG_BYTES)]: pokedexFlags(0b00000111),
        [rangeKey(map.wEventFlags + Math.floor(map.EVENT_GOT_POKEDEX / 8), 4)]: earlyEventBytes(),
      }
    });
    const reader = new PokemonStateReader({ client, version: "red" });

    await expect(reader.readFullState()).resolves.toMatchObject({
      player: {
        name: "RED",
        rivalName: "BLUE",
        money: 123456,
        playTime: "12:34:56.07",
        position: { mapId: 0, y: 4, x: 5 },
      },
      map: { mapId: 0, mapName: "Pallet Town", tilesetId: 0, width: 10, height: 9 },
      party: {
        count: 1,
        members: [{
          slot: 0,
          speciesId: 0x54,
          species: "Pikachu",
          nickname: "SPARKY",
          level: 5,
          hp: 12,
          maxHp: 20,
          status: "OK",
          types: ["Electric", "Electric"],
          moves: [
            { id: 0x21, name: "Tackle", pp: 35, ppUp: 0 },
            { id: 0x54, name: "Thundershock", pp: 30, ppUp: 0 },
          ],
          stats: { attack: 11, defense: 10, speed: 16, special: 12 },
          experience: 135,
        }]
      },
      bag: [
        { id: 0x14, name: "Potion", quantity: 3 },
        { id: 0x46, name: "Oak's Parcel", quantity: 1 },
      ],
      battle: {
        inBattle: true,
        type: "wild",
        enemy: {
          speciesId: 0x54,
          species: "Pikachu",
          level: 5,
          hp: 12,
          maxHp: 20,
          status: "PAR",
        }
      },
      dialog: { active: true, textBoxId: 2, letterPrintingDelayFlags: 1, joyIgnore: 0xff },
      flags: {
        hasPokedex: true,
        hasOaksParcel: true,
        deliveredOaksParcel: false,
        pokedexOwned: 2,
        pokedexSeen: 3,
      }
    });
  });

  it("reuses the already decoded menu text when a full-state read follows a snapshot read", async () => {
    const client = createStateClient();
    const reader = new PokemonStateReader({ client, version: "red" });

    const snapshot = await reader.readState();
    await reader.readFullState({ menuText: snapshot.menuText });

    expect(reader.getLastTileMapBytes()).toEqual(Uint8Array.from(tileMapBytes("Hello there! Welcome to the world of POKEMON!")));
    expect(client.calls.filter((call) => (
      call.method === "readRange" &&
      call.address === map.wTileMap &&
      call.length === map.wTileMapLength
    ))).toHaveLength(1);
  });

  it("does not treat stale textbox metadata as active dialog without joy ignore or visible text", async () => {
    const client = createFakeRamClient({
      bytes: {
        [map.wCurrentMenuItem]: 0,
        [map.wTextBoxID]: 13,
        [map.wLetterPrintingDelayFlags]: 1,
        [map.wNamingScreenNameLength]: 0,
        [map.wNamingScreenSubmitName]: 0,
        [map.wNamingScreenType]: 1,
        [map.wSpritePlayerStateData1FacingDirection]: 0x08,
        [map.wObtainedBadges]: 0,
        [map.wCurMapTileset]: 4,
        [map.wCurMapHeight]: 4,
        [map.wCurMapWidth]: 4,
        [map.wPartyCount]: 0,
        [map.wNumBagItems]: 0,
        [map.wIsInBattle]: 0,
        [map.wJoyIgnore]: 0,
      },
      ranges: {
        [rangeKey(map.wLetterPrintingDelayFlags, map.wXBlockCoord - map.wLetterPrintingDelayFlags + 1)]: overworldRange({ [map.wCurMap]: 0x26, [map.wYCoord]: 3, [map.wXCoord]: 3 }),
        [rangeKey(map.wTileMap, map.wTileMapLength)]: Array.from({ length: map.wTileMapLength }, () => 0x7f),
        [rangeKey(map.wPlayerName, map.NAME_LENGTH)]: nameBytes("AAAAAAA"),
        [rangeKey(map.wRivalName, map.NAME_LENGTH)]: nameBytes("AAAAAAA"),
        [rangeKey(map.wPlayerMoney, 3)]: [0x00, 0x30, 0x00],
        [rangeKey(map.wPlayTimeHours, 5)]: [1, 0, 0x24, 0x06, 0x11],
        [rangeKey(map.wPokedexOwned, map.POKEDEX_FLAG_BYTES)]: pokedexFlags(0),
        [rangeKey(map.wPokedexSeen, map.POKEDEX_FLAG_BYTES)]: pokedexFlags(0),
        [rangeKey(map.wEventFlags + Math.floor(map.EVENT_GOT_POKEDEX / 8), 4)]: [0, 0, 0, 0],
      }
    });
    const reader = new PokemonStateReader({ client, version: "red" });

    await expect(reader.readFullState()).resolves.toMatchObject({
      dialog: {
        active: false,
        textBoxId: 13,
        letterPrintingDelayFlags: 1,
        joyIgnore: 0,
      }
    });
  });
});

function nameBytes(name: string): number[] {
  const bytes = Array.from({ length: map.NAME_LENGTH }, () => 0x50);
  Array.from(name).forEach((character, index) => {
    bytes[index] = encodeTile(character);
  });
  return bytes;
}

function partyNickBytes(name: string): number[] {
  const bytes = Array.from({ length: map.PARTY_LENGTH * map.NAME_LENGTH }, () => 0x50);
  nameBytes(name).forEach((byte, index) => { bytes[index] = byte; });
  return bytes;
}

function partyMonsBytes(): number[] {
  const bytes = Array.from({ length: map.PARTY_LENGTH * map.PARTYMON_STRUCT_LENGTH }, () => 0);
  bytes[0] = 0x54; // Pikachu
  writeWord(bytes, 1, 12);
  bytes[4] = 0;
  bytes[5] = 0x17;
  bytes[6] = 0x17;
  bytes[8] = 0x21;
  bytes[9] = 0x54;
  bytes[14] = 0x00;
  bytes[15] = 0x00;
  bytes[16] = 135;
  bytes[29] = 35;
  bytes[30] = 30;
  bytes[33] = 5;
  writeWord(bytes, 34, 20);
  writeWord(bytes, 36, 11);
  writeWord(bytes, 38, 10);
  writeWord(bytes, 40, 16);
  writeWord(bytes, 42, 12);
  return bytes;
}

function enemyMonBytes(): number[] {
  const bytes = Array.from({ length: map.BATTLEMON_STRUCT_LENGTH }, () => 0);
  bytes[0] = 0x54;
  writeWord(bytes, 1, 12);
  bytes[4] = 0x40;
  bytes[5] = 0x17;
  bytes[6] = 0x17;
  bytes[8] = 0x21;
  bytes[9] = 0x54;
  bytes[14] = 5;
  writeWord(bytes, 15, 20);
  bytes[25] = 35;
  bytes[26] = 30;
  return bytes;
}

function bagBytes(): number[] {
  const bytes = Array.from({ length: map.BAG_ITEM_CAPACITY * 2 + 1 }, () => 0xff);
  bytes[0] = 0x14;
  bytes[1] = 3;
  bytes[2] = 0x46;
  bytes[3] = 1;
  return bytes;
}

function pokedexFlags(firstByte: number): number[] {
  const bytes = Array.from({ length: map.POKEDEX_FLAG_BYTES }, () => 0);
  bytes[0] = firstByte;
  return bytes;
}

function earlyEventBytes(): number[] {
  const bytes = [0, 0, 0, 0];
  bytes[0] |= 1 << (map.EVENT_GOT_POKEDEX % 8);
  bytes[3] |= 1 << (map.EVENT_GOT_OAKS_PARCEL % 8);
  return bytes;
}

function writeWord(bytes: number[], offset: number, value: number): void {
  bytes[offset] = value >> 8;
  bytes[offset + 1] = value & 0xff;
}
