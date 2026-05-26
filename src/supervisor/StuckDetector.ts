import type { HarnessAction } from "../control/ActionTypes.js";
import type { FullGameState } from "../game/PokemonTypes.js";

export interface StuckDetectorThresholds {
  readonly repeatedActionCount: number;
  readonly stableLocationCount: number;
}

export interface StuckDetectorInput {
  readonly fullState?: FullGameState;
  readonly recentActions?: readonly unknown[];
  readonly recentStates?: readonly unknown[];
  readonly step?: number;
  readonly detectorStatus?: unknown;
}

export interface StuckDetection {
  readonly stuck: boolean;
  readonly reasons: readonly string[];
  readonly repeatedActionCount: number;
  readonly stableLocationCount: number;
  readonly repeatedActionSignature?: string;
  readonly stableContextSignature?: string;
}

export type StuckSeverity = "none" | "soft" | "hard";

export interface StuckDetectionV2 extends StuckDetection {
  readonly severity: StuckSeverity;
  readonly levels: {
    readonly actionLoop: boolean;
    readonly locationLoop: boolean;
    readonly noProgress: boolean;
    readonly backtrackLoop: boolean;
  };
}

export const defaultStuckDetectorThresholds: StuckDetectorThresholds = {
  repeatedActionCount: 4,
  stableLocationCount: 5,
};

export class StuckDetector {
  private readonly thresholds: StuckDetectorThresholds;

  constructor(thresholds: StuckDetectorThresholds = defaultStuckDetectorThresholds) {
    this.thresholds = thresholds;
  }

  analyze(input: StuckDetectorInput): StuckDetection {
    return analyzeStuckSignals(input, this.thresholds);
  }

  analyzeV2(input: StuckDetectorInput): StuckDetectionV2 {
    return analyzeStuckSignalsV2(input, this.thresholds);
  }
}

export function analyzeStuckSignals(
  input: StuckDetectorInput,
  thresholds: StuckDetectorThresholds = defaultStuckDetectorThresholds
): StuckDetection {
  const repeated = trailingRepeat(input.recentActions?.map(actionSignature) ?? []);
  const stable = trailingRepeat(input.recentStates?.map(progressSignature) ?? []);
  const reasons: string[] = [];
  const stuck = isRecoverableLoopCandidate(input.fullState) &&
    repeated.count >= thresholds.repeatedActionCount &&
    stable.count >= thresholds.stableLocationCount;

  if (stuck) {
    reasons.push(`Same action repeated ${repeated.count} times while progress context stayed stable for ${stable.count} observations.`);
  }

  return {
    stuck,
    reasons,
    repeatedActionCount: repeated.count,
    stableLocationCount: stable.count,
    repeatedActionSignature: repeated.signature,
    stableContextSignature: stable.signature,
  };
}

export function analyzeStuckSignalsV2(
  input: StuckDetectorInput,
  thresholds: StuckDetectorThresholds = defaultStuckDetectorThresholds
): StuckDetectionV2 {
  const baseline = analyzeStuckSignals(input, thresholds);
  const levels: StuckDetectionV2["levels"] = {
    actionLoop: baseline.stuck,
    locationLoop: detectLocationLoop(input.recentStates ?? []),
    noProgress: detectNoProgress(input),
    backtrackLoop: detectBacktrackLoop(input.recentStates ?? []),
  };
  const severity = computeSeverity(levels);

  return {
    ...baseline,
    stuck: severity !== "none",
    reasons: buildV2Reasons(baseline.reasons, levels),
    severity,
    levels,
  };
}

function buildV2Reasons(
  baselineReasons: readonly string[],
  levels: StuckDetectionV2["levels"]
): readonly string[] {
  const reasons = [...baselineReasons];
  if (levels.locationLoop) {
    reasons.push("Recent states oscillated between a small set of maps without route progress.");
  }
  if (levels.noProgress) {
    reasons.push("Supervisor progress checkpoint has not advanced for many turns.");
  }
  if (levels.backtrackLoop) {
    reasons.push("Recent map sequence shows repeated advance-retreat backtracking.");
  }
  return reasons;
}

function computeSeverity(levels: StuckDetectionV2["levels"]): StuckSeverity {
  const activeLevelCount = [
    levels.actionLoop,
    levels.locationLoop,
    levels.noProgress,
    levels.backtrackLoop,
  ].filter(Boolean).length;
  if (activeLevelCount === 0) {
    return "none";
  }
  if (activeLevelCount === 1) {
    return "soft";
  }
  return "hard";
}

function detectLocationLoop(states: readonly unknown[]): boolean {
  if (states.length < 6) {
    return false;
  }

  const mapIds = states.map(extractMapId).filter((id): id is number => id !== undefined);
  if (mapIds.length < 6) {
    return false;
  }

  const uniqueMaps = new Set(mapIds);
  let transitions = 0;
  for (let index = 1; index < mapIds.length; index += 1) {
    if (mapIds[index] !== mapIds[index - 1]) {
      transitions += 1;
    }
  }

  return uniqueMaps.size <= 3 && transitions >= 4;
}

function detectNoProgress(input: StuckDetectorInput): boolean {
  if (typeof input.step !== "number") {
    return false;
  }
  if (input.detectorStatus === null || typeof input.detectorStatus !== "object") {
    return false;
  }

  const status = input.detectorStatus as { readonly lastProgressStep?: unknown };
  if (typeof status.lastProgressStep !== "number") {
    return false;
  }

  return input.step - status.lastProgressStep > 30;
}

function detectBacktrackLoop(states: readonly unknown[]): boolean {
  if (states.length < 5) {
    return false;
  }

  const mapIds = states.map(extractMapId).filter((id): id is number => id !== undefined);
  if (mapIds.length < 5) {
    return false;
  }

  let backtracks = 0;
  for (let index = 2; index < mapIds.length; index += 1) {
    if (mapIds[index] === mapIds[index - 2] && mapIds[index] !== mapIds[index - 1]) {
      backtracks += 1;
    }
  }
  return backtracks >= 2;
}

function extractMapId(state: unknown): number | undefined {
  if (state === null || typeof state !== "object") {
    return;
  }

  const record = state as Record<string, unknown>;
  const flatMapId = firstNumber(record.mapId, record.wCurMap);
  if (flatMapId !== undefined) {
    return flatMapId;
  }

  const nested = state as { readonly player?: { readonly position?: { readonly mapId?: unknown } } };
  return firstNumber(nested.player?.position?.mapId);
}

function trailingRepeat(signatures: readonly string[]): { readonly count: number; readonly signature?: string } {
  const last = signatures.at(-1);
  if (last === undefined) {
    return { count: 0 };
  }

  let count = 0;
  for (let index = signatures.length - 1; index >= 0; index -= 1) {
    if (signatures[index] !== last) {
      break;
    }
    count += 1;
  }
  return { count, signature: last };
}

function isRecoverableLoopCandidate(state: FullGameState | undefined): boolean {
  if (state === undefined) {
    return true;
  }
  if (state.battle.inBattle) {
    return false;
  }
  if (state.dialog.active) {
    return false;
  }
  if (state.menuText.screenText.trim().length > 0) {
    return false;
  }
  if (state.menuText.screenTextKind === "naming_screen") {
    return false;
  }
  return true;
}

function actionSignature(value: unknown): string {
  const action = unwrapAction(value);
  if (action === undefined) {
    return stableSignature(value);
  }
  if (action.type === "press" || action.type === "hold") {
    return `${action.type}:${action.button}:${action.frames}`;
  }
  if (action.type === "wait") {
    return `wait:${action.frames}`;
  }
  return `sequence:${action.actions.map(actionSignature).join("|")}`;
}

function unwrapAction(value: unknown): HarnessAction | undefined {
  if (value === null || typeof value !== "object") {
    return;
  }
  const record = value as { readonly action?: unknown };
  const candidate = record.action ?? value;
  if (candidate === null || typeof candidate !== "object") {
    return;
  }
  const action = candidate as Partial<HarnessAction>;
  return typeof action.type === "string" ? action as HarnessAction : undefined;
}

function progressSignature(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return stableSignature(value);
  }
  const record = value as Record<string, unknown>;
  let mapId = firstNumber(record.mapId, record.wCurMap);
  let y = firstNumber(record.y, record.wYCoord);
  let x = firstNumber(record.x, record.wXCoord);
  let battle = firstPrimitive(record.battle, record.wIsInBattle);
  let textBox = firstPrimitive(record.textBoxId, record.wTextBoxID);
  let screenTextKind = firstPrimitive(record.screenTextKind);
  let screenText = firstPrimitive(record.screenText);
  let menuItem = firstPrimitive(record.menuItem, record.wCurrentMenuItem);
  let partyHp = firstPrimitive(record.wPartyMon1HP);
  const enemyHp = firstPrimitive(record.wEnemyMonHP);

  if (mapId === undefined) {
    const nested = value as {
      readonly player?: { readonly position?: { readonly mapId?: number; readonly y?: number; readonly x?: number } };
      readonly battle?: { readonly inBattle?: boolean };
      readonly dialog?: { readonly textBoxId?: number };
      readonly menuText?: {
        readonly screenText?: string;
        readonly screenTextKind?: string;
        readonly currentMenuItem?: number;
      };
      readonly party?: { readonly members?: readonly { readonly hp?: number }[] };
    };

    mapId = firstNumber(nested.player?.position?.mapId);
    y = firstNumber(nested.player?.position?.y) ?? y;
    x = firstNumber(nested.player?.position?.x) ?? x;
    battle = firstPrimitive(nested.battle?.inBattle) ?? battle;
    textBox = firstPrimitive(nested.dialog?.textBoxId) ?? textBox;
    screenTextKind = firstPrimitive(nested.menuText?.screenTextKind) ?? screenTextKind;
    screenText = firstPrimitive(nested.menuText?.screenText) ?? screenText;
    menuItem = firstPrimitive(nested.menuText?.currentMenuItem) ?? menuItem;
    partyHp = firstPrimitive(nested.party?.members?.[0]?.hp) ?? partyHp;
  }

  if (mapId !== undefined && y !== undefined && x !== undefined) {
    return [
      `loc=${mapId}:${y}:${x}`,
      `battle=${battle ?? "unknown"}`,
      `textBox=${textBox ?? "unknown"}`,
      `text=${screenTextKind ?? screenText ?? "unknown"}`,
      `menu=${menuItem ?? "unknown"}`,
      `partyHp=${partyHp ?? "unknown"}`,
      `enemyHp=${enemyHp ?? "unknown"}`,
    ].join("|");
  }
  return stableSignature(value);
}

function firstNumber(...values: readonly unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number");
}

function firstPrimitive(...values: readonly unknown[]): string | number | boolean | undefined {
  return values.find((value): value is string | number | boolean => (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ));
}

function stableSignature(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(sortJson(value)) : String(value);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)])
    );
  }

  return value;
}
