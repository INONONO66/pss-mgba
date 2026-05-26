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
}

export interface StuckDetection {
  readonly stuck: boolean;
  readonly reasons: readonly string[];
  readonly repeatedActionCount: number;
  readonly stableLocationCount: number;
  readonly repeatedActionSignature?: string;
  readonly stableContextSignature?: string;
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

function trailingRepeat(signatures: readonly string[]): { readonly count: number; readonly signature?: string } {
  const last = signatures.at(-1);
  if (last === undefined) return { count: 0 };

  let count = 0;
  for (let index = signatures.length - 1; index >= 0; index -= 1) {
    if (signatures[index] !== last) break;
    count += 1;
  }
  return { count, signature: last };
}

function isRecoverableLoopCandidate(state: FullGameState | undefined): boolean {
  if (state === undefined) return true;
  if (state.battle.inBattle) return false;
  if (state.dialog.active) return false;
  if (state.menuText.screenText.trim().length > 0) return false;
  if (state.menuText.screenTextKind === "naming_screen") return false;
  return true;
}

function actionSignature(value: unknown): string {
  const action = unwrapAction(value);
  if (action === undefined) return stableSignature(value);
  if (action.type === "press" || action.type === "hold") return `${action.type}:${action.button}:${action.frames}`;
  if (action.type === "wait") return `wait:${action.frames}`;
  return `sequence:${action.actions.map(actionSignature).join("|")}`;
}

function unwrapAction(value: unknown): HarnessAction | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as { readonly action?: unknown };
  const candidate = record.action ?? value;
  if (candidate === null || typeof candidate !== "object") return undefined;
  const action = candidate as Partial<HarnessAction>;
  return typeof action.type === "string" ? action as HarnessAction : undefined;
}

function progressSignature(value: unknown): string {
  if (value === null || typeof value !== "object") return stableSignature(value);
  const record = value as Record<string, unknown>;
  const mapId = firstNumber(record.mapId, record.wCurMap);
  const y = firstNumber(record.y, record.wYCoord);
  const x = firstNumber(record.x, record.wXCoord);
  const battle = firstPrimitive(record.battle, record.wIsInBattle);
  const textBox = firstPrimitive(record.textBoxId, record.wTextBoxID);
  const screenTextKind = firstPrimitive(record.screenTextKind);
  const screenText = firstPrimitive(record.screenText);
  const menuItem = firstPrimitive(record.menuItem, record.wCurrentMenuItem);
  const partyHp = firstPrimitive(record.wPartyMon1HP);
  const enemyHp = firstPrimitive(record.wEnemyMonHP);
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
