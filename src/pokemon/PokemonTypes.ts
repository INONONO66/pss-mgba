// ---------------------------------------------------------------------------
// Core enums / primitives
// ---------------------------------------------------------------------------

export type BattleKind = "none" | "wild" | "trainer" | "lost";

export type BattleFlag =
  | { kind: "none"; raw: 0 }
  | { kind: "wild"; raw: 1 }
  | { kind: "trainer"; raw: 2 }
  | { kind: "lost"; raw: 255 };

export type PlayerFacingDirection = "down" | "up" | "left" | "right";

export interface PlayerFacing {
  raw: number;
  direction: PlayerFacingDirection;
}

export type ScreenTextKind = "none" | "oak_intro" | "default_name_menu" | "naming_screen" | "overworld_text";

// ---------------------------------------------------------------------------
// Coordinates / Map
// ---------------------------------------------------------------------------

export interface PokemonCoordinates {
  mapId: number;
  y: number;
  x: number;
  yBlock: number;
  xBlock: number;
}

export interface MapInfo {
  readonly mapId: number;
  readonly mapName: string;
  readonly tilesetId: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// HP / Status
// ---------------------------------------------------------------------------

export interface HitPoints {
  current: number;
  max?: number;
}

export type StatusCondition = "OK" | string;

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export interface MoveSlot {
  readonly id: number;
  readonly name: string;
  readonly pp: number;
  readonly ppUp: number;
  readonly maxPp?: number;
}

// ---------------------------------------------------------------------------
// Party Pokemon (full detail)
// ---------------------------------------------------------------------------

export interface PartyPokemon {
  readonly slot: number;
  readonly speciesId: number;
  readonly species: string;
  readonly nickname: string;
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly status: StatusCondition;
  readonly types: readonly [string, string];
  readonly moves: readonly MoveSlot[];
  readonly stats: {
    readonly attack: number;
    readonly defense: number;
    readonly speed: number;
    readonly special: number;
  };
  readonly experience: number;
}

export interface PartySummary {
  count: number;
  firstPokemonHp?: HitPoints;
}

export interface PartyDetail {
  readonly count: number;
  readonly members: readonly PartyPokemon[];
}

// ---------------------------------------------------------------------------
// Enemy Pokemon (battle)
// ---------------------------------------------------------------------------

export interface EnemyPokemon {
  readonly speciesId: number;
  readonly species: string;
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly status: StatusCondition;
  readonly types: readonly [string, string];
  readonly moves: readonly MoveSlot[];
}

export interface BattleState {
  readonly inBattle: boolean;
  readonly type: BattleKind;
  readonly enemy?: EnemyPokemon;
}

// ---------------------------------------------------------------------------
// Bag
// ---------------------------------------------------------------------------

export interface BagItem {
  readonly id: number;
  readonly name: string;
  readonly quantity: number;
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export interface DialogState {
  readonly active: boolean;
  readonly textBoxId: number;
  readonly letterPrintingDelayFlags: number;
  readonly joyIgnore: number;
}

// ---------------------------------------------------------------------------
// Story flags / progression
// ---------------------------------------------------------------------------

export interface BadgeProgress {
  raw: number;
  count: number;
  obtained: readonly boolean[];
  names: readonly string[];
}

export interface StoryFlags {
  readonly hasPokedex: boolean;
  readonly hasOaksParcel: boolean;
  readonly deliveredOaksParcel: boolean;
  readonly pokedexOwned: number;
  readonly pokedexSeen: number;
  readonly badges: BadgeProgress;
}

// ---------------------------------------------------------------------------
// Player info
// ---------------------------------------------------------------------------

export interface PlayerInfo {
  readonly name: string;
  readonly rivalName: string;
  readonly money: number;
  readonly position: PokemonCoordinates;
  readonly facing: PlayerFacing;
  readonly badges: BadgeProgress;
  readonly playTime: string;
}

// ---------------------------------------------------------------------------
// Menu / text (existing, kept for compatibility)
// ---------------------------------------------------------------------------

export interface MenuTextState {
  currentMenuItem: number;
  textBoxId: number;
  letterPrintingDelayFlags: number;
  screenText: string;
  screenTextKind: ScreenTextKind;
  namingScreenNameLength: number;
  namingScreenSubmitName: number;
  namingScreenType: number;
}

// ---------------------------------------------------------------------------
// Full game state (for LLM injection)
// ---------------------------------------------------------------------------

export interface FullGameState {
  readonly player: PlayerInfo;
  readonly map: MapInfo;
  readonly party: PartyDetail;
  readonly bag: readonly BagItem[];
  readonly battle: BattleState;
  readonly dialog: DialogState;
  readonly flags: StoryFlags;
  readonly menuText: MenuTextState;
}

// ---------------------------------------------------------------------------
// Legacy aggregate (kept for existing code)
// ---------------------------------------------------------------------------

export interface PokemonGameState {
  battle: BattleFlag;
  coordinates: PokemonCoordinates;
  playerFacing: PlayerFacing;
  party: PartySummary;
  badges: BadgeProgress;
  menuText: MenuTextState;
}
