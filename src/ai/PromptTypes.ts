import type { GameMode, CommandResult, CommandHistoryEntry } from "../control/CommandTypes.js";
import type { FullGameState } from "../pokemon/PokemonTypes.js";

export interface PokemonStateSnapshot {
  wIsInBattle?: number | boolean;
  wPartyCount?: number;
  partyCount?: number;
  wObtainedBadges?: number;
  badgeCount?: number;
  badgesObtained?: readonly boolean[];
  hallOfFameComplete?: boolean;
  wCurMap?: number;
  wYCoord?: number;
  wXCoord?: number;
  wSpritePlayerStateData1FacingDirection?: number;
  playerFacingDirection?: string;
  wTextBoxID?: number;
  textBoxId?: number;
  screenText?: string;
  screenTextKind?: string;
  wCurrentMenuItem?: number;
  menuItem?: number;
  wLetterPrintingDelayFlags?: number;
  letterDelayFlags?: number;
  wNamingScreenNameLength?: number;
  wNamingScreenSubmitName?: number;
  wNamingScreenType?: number;
  menuActive?: boolean;
  textActive?: boolean;
  [key: string]: unknown;
}

export interface RecentStateSnapshot extends PokemonStateSnapshot {
  step?: number;
}

export interface PolicyInput {
  state?: PokemonStateSnapshot;
  currentState?: unknown;
  recentActions?: readonly unknown[];
  recentStates?: readonly RecentStateSnapshot[];
  step?: number;
  objective?: string;
  adviserHint?: string;
  detectorStatus?: unknown;
  fullState?: FullGameState;
  fullStateSummary?: string;
  fullStateError?: string;
  mapAscii?: string;
  mapStateError?: string;
  mapStateWarning?: string;
  mapFresh?: boolean;
  walkGrid?: { grid: boolean[][]; width: number; height: number };
  mapTileCount?: number;
  mapTotalTiles?: number;
  visitedMaps?: number[];

  mode?: GameMode;
  lastResult?: CommandResult;
  commandHistory?: CommandHistoryEntry[];
  mapGraph?: string;
  currentMapFull?: string;
  microContext?: {
    position: { y: number; x: number };
    facing: string;
    adjacent: Record<string, string>;
    warps?: Array<{ y: number; x: number; destMapId: number; destMapName: string }>;
    npcs?: Array<{ slot: number; pictureId: number; mapY: number; mapX: number; facing: string; movementType: string }>;
  };
}
