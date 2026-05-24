import type { HarnessAction } from "../control/ActionTypes.js";
import type { FullGameState, PartyPokemon } from "../pokemon/PokemonTypes.js";
import type { SupervisorAssessment, SupervisorGoal, SupervisorInput, SupervisorPlan, SupervisorProgressState } from "./SupervisorTypes.js";

const LOOP_ACTION_THRESHOLD = 4;
const STABLE_CONTEXT_THRESHOLD = 5;
const MAX_GOALS = 4;

export function buildPokemonSupervisorPlan(input: SupervisorInput): SupervisorPlan {
  const assessment = assessProgress(input);
  const activeGoal = withStatus(selectActiveGoal(input, assessment), "active");
  const goals = orderGoals([
    activeGoal,
    ...candidateStoryGoals(input.fullState).filter((goal) => goal.id !== activeGoal.id),
  ]).slice(0, MAX_GOALS);

  return {
    version: 1,
    generatedAtStep: input.step,
    assessment,
    activeGoal,
    goals,
    guidance: buildGuidance(input, activeGoal, assessment),
    avoid: [
      "Do not follow a memorized route script; use only the current observed state.",
      "Do not repeat the same input if the map, dialog, battle, and menu state are not changing.",
      "Do not declare completion until the Hall of Fame state is observed.",
    ],
    citations: buildCitations(input, assessment),
  };
}

function assessProgress(input: SupervisorInput): SupervisorAssessment {
  const repeatedActionCount = countRepeatedTrailingActions(input.recentActions);
  const stableLocationCount = countStableTrailingContexts(input.recentStates);
  const reasons: string[] = [];
  let state: SupervisorProgressState = "progressing";

  if (input.fullState?.player.position.mapId === 0x76) {
    state = "complete";
    reasons.push("Hall of Fame map/state is observed.");
  }

  if (input.mapStateError !== undefined) {
    state = state === "complete" ? state : "blocked";
    reasons.push(`Map context unavailable: ${input.mapStateError}`);
  }

  if (input.mapFresh === false && input.mapStateWarning !== undefined) {
    reasons.push(input.mapStateWarning);
  }

  if (isRecoverableLoopCandidate(input) && repeatedActionCount >= LOOP_ACTION_THRESHOLD && stableLocationCount >= STABLE_CONTEXT_THRESHOLD) {
    state = state === "complete" ? state : "stuck";
    reasons.push(`Same action repeated ${repeatedActionCount} times while progress context stayed stable for ${stableLocationCount} observations.`);
  }

  const lead = input.fullState?.party.members[0];
  if (input.fullState?.battle.inBattle === true && lead !== undefined && isLowHp(lead)) {
    reasons.push(`Lead Pokemon HP is low (${lead.hp}/${lead.maxHp}).`);
  }

  return {
    state,
    reasons: reasons.length > 0 ? reasons : ["No stall signal detected."],
    repeatedActionCount,
    stableLocationCount,
  };
}

function selectActiveGoal(input: SupervisorInput, assessment: SupervisorAssessment): SupervisorGoal {
  const state = input.fullState;

  if (assessment.state === "complete") {
    return goal("complete", "complete", "Ending observed", 100, "The observed state satisfies the completion condition.", [
      "Stop only after evidence records the Hall of Fame state.",
    ]);
  }

  if (state === undefined) {
    return goal("observe-state", "explore", "Gather reliable live state", 80, "Full game state is not available this step.", [
      "Use safe inputs that reveal whether the game is in dialog, menu, battle, or overworld.",
    ]);
  }

  if (state.battle.inBattle) {
    return goal("win-current-battle", "win-battle", "Win the current battle", 90, "A battle is active and blocks overworld progress.", [
      "Use available damaging moves when PP is available.",
      "If HP is low and the bag has healing items, consider a healing action through the battle menu.",
      "Continue until battle exits or a loss is observed.",
    ]);
  }

  if (state.menuText.screenTextKind === "naming_screen") {
    return goal("complete-naming", "complete-naming", "Complete the naming prompt", 84, "A naming UI is active and blocks movement.", [
      "Choose a valid name or accept a default name.",
      "Exit the naming UI and confirm the resulting player/rival name state.",
    ]);
  }

  if (state.dialog.active || state.menuText.screenText.trim().length > 0) {
    return goal("resolve-dialog", "clear-dialog", "Resolve active dialog or prompt", 85, "The game is currently presenting text or a prompt.", [
      "Advance text or choose the option that keeps story progress moving.",
      "After the prompt clears, re-evaluate the map and player state.",
    ]);
  }

  if (assessment.state === "stuck") {
    return goal("recover-loop", "recover-from-loop", "Break the current input loop", 95, "Recent actions are repeating without observed movement or state change.", [
      "Try a different legal action than the repeated input.",
      "If facing an NPC/sign/object, interact once; otherwise move toward an open adjacent tile.",
      "If a menu/dialog is open, close or advance it before exploring.",
    ]);
  }

  return candidateStoryGoals(state)[0] ?? goal("explore-current-map", "explore", "Explore from the current position", 50, "No higher-priority blocker is active.", [
    "Prefer open adjacent tiles, unexplored map cells, doors, stairs, warps, and interactable objects.",
    "Re-check state after each movement or interaction.",
  ]);
}

function candidateStoryGoals(state: FullGameState | undefined): SupervisorGoal[] {
  if (state === undefined) return [];

  const goals: SupervisorGoal[] = [];
  if (state.party.count === 0) {
    goals.push(goal("obtain-first-pokemon", "advance-story", "Obtain the first party Pokemon", 75, "The party is empty, so battles and route progress are unsafe.", [
      "Find the local story interaction that gives a party Pokemon.",
      "Confirm party count becomes at least 1.",
    ]));
  } else if (state.flags.hasOaksParcel && !state.flags.deliveredOaksParcel) {
    goals.push(goal("deliver-held-story-item", "advance-story", "Deliver the held story item", 74, "A story item is held and not delivered yet.", [
      "Return to the requester or relevant story NPC using observed map/dialog cues.",
      "Confirm the delivered flag changes or the item is removed.",
    ]));
  } else if (state.player.badges.count < 8) {
    goals.push(goal("earn-next-badge", "earn-badges", "Earn the next badge", 65, `Observed ${state.player.badges.count}/8 badges.`, [
      "Explore towns and gyms using live map state.",
      "Keep party healthy and level through battles when needed.",
    ]));
  } else {
    goals.push(goal("reach-hall-of-fame", "reach-ending", "Reach the Hall of Fame", 70, "All badges are observed but the ending state is not.", [
      "Advance toward the final challenge using observed map, battle, and dialog state.",
      "Only mark complete when Hall of Fame state is observed.",
    ]));
  }

  goals.push(goal("expand-map-knowledge", "explore", "Expand reliable map knowledge", 40, "More local map coverage improves action selection.", [
    "Move through open adjacent tiles and record new map cells.",
    "Prefer fresh map context; treat stale map warnings as uncertain.",
  ]));

  return goals;
}

function buildGuidance(input: SupervisorInput, activeGoal: SupervisorGoal, assessment: SupervisorAssessment): string[] {
  const state = input.fullState;
  const guidance = [
    `Current focus: ${activeGoal.title}.`,
    activeGoal.successCriteria[0] ?? activeGoal.why,
  ];

  if (assessment.state === "stuck") {
    guidance.push("Because progress appears stuck, choose a different action category than the repeated recent input.");
  }

  if (state?.battle.inBattle === true) {
    const lead = state.party.members[0];
    const bestMove = lead?.moves.find((move) => move.pp > 0);
    if (bestMove !== undefined) {
      guidance.push(`A usable lead move exists: ${bestMove.name} with ${bestMove.pp} PP.`);
    }
  }

  if (input.mapStateWarning !== undefined) {
    guidance.push(`Treat spatial guidance as uncertain: ${input.mapStateWarning}`);
  }

  return guidance.slice(0, 5);
}

function buildCitations(input: SupervisorInput, assessment: SupervisorAssessment): string[] {
  const state = input.fullState;
  const citations: string[] = [
    `assessment=${assessment.state}`,
    `repeatedActionCount=${assessment.repeatedActionCount}`,
    `stableLocationCount=${assessment.stableLocationCount}`,
  ];

  if (input.step !== undefined) citations.push(`step=${input.step}`);
  if (state !== undefined) {
    citations.push(`map=${state.map.mapName}#${state.map.mapId}`);
    citations.push(`pos=${state.player.position.y},${state.player.position.x}`);
    citations.push(`badges=${state.player.badges.count}`);
    citations.push(`party=${state.party.count}`);
    if (state.battle.inBattle) citations.push(`battle=${state.battle.type}`);
    if (state.dialog.active) citations.push(`dialog=textBox${state.dialog.textBoxId}`);
  }

  return citations.slice(0, 10);
}

function orderGoals(goals: readonly SupervisorGoal[]): SupervisorGoal[] {
  const seen = new Set<string>();
  return [...goals]
    .filter((goal) => {
      if (seen.has(goal.id)) return false;
      seen.add(goal.id);
      return true;
    })
    .sort((left, right) => right.priority - left.priority);
}

function goal(
  id: string,
  kind: SupervisorGoal["kind"],
  title: string,
  priority: number,
  why: string,
  successCriteria: readonly string[]
): SupervisorGoal {
  return { id, kind, title, status: "pending", priority, why, successCriteria };
}

function withStatus(goal: SupervisorGoal, status: SupervisorGoal["status"]): SupervisorGoal {
  return { ...goal, status };
}

function isRecoverableLoopCandidate(input: SupervisorInput): boolean {
  const state = input.fullState;
  if (state === undefined) return true;
  if (state.battle.inBattle) return false;
  if (state.dialog.active) return false;
  if (state.menuText.screenText.trim().length > 0) return false;
  if (state.menuText.screenTextKind === "naming_screen") return false;
  return true;
}

function countRepeatedTrailingActions(actions: readonly unknown[] | undefined): number {
  if (actions === undefined || actions.length === 0) return 0;
  const signatures = actions.map(actionSignature);
  const last = signatures[signatures.length - 1];
  if (last === undefined) return 0;

  let count = 0;
  for (let index = signatures.length - 1; index >= 0; index -= 1) {
    if (signatures[index] !== last) break;
    count += 1;
  }
  return count;
}

function countStableTrailingContexts(states: readonly unknown[] | undefined): number {
  if (states === undefined || states.length === 0) return 0;
  const signatures = states.map(progressSignature);
  const last = signatures[signatures.length - 1];
  if (last === undefined) return 0;

  let count = 0;
  for (let index = signatures.length - 1; index >= 0; index -= 1) {
    if (signatures[index] !== last) break;
    count += 1;
  }
  return count;
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
  const record = value as { readonly action?: unknown; readonly type?: unknown };
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

function isLowHp(pokemon: PartyPokemon): boolean {
  return pokemon.maxHp > 0 && pokemon.hp / pokemon.maxHp <= 0.25;
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
