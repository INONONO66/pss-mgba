import type { PolicyDecision } from "../control/ActionTypes.js";
import type { PolicyDecision as CommandPolicyDecision, GameMode, CommandResult, CommandHistoryEntry } from "../control/CommandTypes.js";
import type { LlmVisionDetail } from "../config.js";
import type { FullGameState } from "../pokemon/PokemonTypes.js";

export interface VisionImageInput {
  readonly path: string;
  readonly sourcePath: string;
  readonly mediaType: "image/jpeg" | "image/webp" | "image/png";
  readonly width: number;
  readonly height: number;
  readonly step: number;
  readonly frame: number;
  readonly crop: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly bytes: number;
  readonly detail?: LlmVisionDetail;
}

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
  visionImages?: readonly VisionImageInput[];
  step?: number;
  objective?: string;
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
  };
}

export interface Policy {
  chooseAction(input: PolicyInput): Promise<PolicyDecision>;
}

export interface CommandPolicy {
  chooseAction(input: PolicyInput): Promise<CommandPolicyDecision>;
}

export type { CommandPolicyDecision };
