import { PolicyDecisionSchema } from "../control/ActionSchema.js";
import { CommandPolicyDecisionSchema } from "../control/CommandSchema.js";
import type { HoldAction, PolicyDecision, PressAction } from "../control/ActionTypes.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";
import type { CommandPolicy, CommandPolicyDecision, Policy, PolicyInput, PokemonStateSnapshot, RecentStateSnapshot } from "./Policy.js";

const DEFAULT_PRESS_FRAMES = 5;
const DEFAULT_WAIT_FRAMES = 5;
const DEFAULT_HOLD_FRAMES = 18;
const REPEATED_STATE_THRESHOLD = 3;
const RED_HOUSE_STALE_TEXT_REPEAT_THRESHOLD = 3;
const PLAYER_FACING_RIGHT = 0x0c;

const EXPLORATORY_BUTTONS = ["Up", "Right", "Down", "Left"] as const;

export class HeuristicPolicy implements Policy {
  async chooseAction(input: PolicyInput): Promise<PolicyDecision> {
    const state = toStateSnapshot(input);
    const sameCoordRepeats = countSameCoordinateRepeats(state, input.recentStates ?? []);
    const bootTitleRepeats = countBootTitleRepeats(state, input.recentStates ?? []);
    const citations = buildObservedStateCitations(state, sameCoordRepeats, bootTitleRepeats);

    if (isBootTitleLikeZeroState(state)) {
      const button = chooseBootTitleButton(bootTitleRepeats);
      return validateDecision({
        action: press(button),
        rationale:
          `${button} is safe while Red/Blue RAM is still all zero, indicating boot/title or uninitialized state rather than initialized overworld coordinates.`,
        confidence: 0.62,
        observedStateCitations: citations
      });
    }

    if (isInBattle(state)) {
      return validateDecision({
        action: press("A"),
        rationale: "Active battle is visible, so press A to progress battle menus or selected moves without inventing a route.",
        confidence: 0.72,
        observedStateCitations: citations
      });
    }

    const postStarterOakLabDecision = choosePostStarterOakLabAction(state);
    if (postStarterOakLabDecision !== undefined) {
      return validateDecision({
        action: postStarterOakLabDecision.action,
        rationale: postStarterOakLabDecision.rationale,
        confidence: 0.7,
        observedStateCitations: citations
      });
    }

    const oakLabDecision = chooseOakLabStarterAction(state, sameCoordRepeats);
    if (oakLabDecision !== undefined) {
      return validateDecision({
        action: oakLabDecision.action,
        rationale: oakLabDecision.rationale,
        confidence: 0.7,
        observedStateCitations: citations
      });
    }

    const introDecision = chooseIntroScreenAction(state);
    if (introDecision !== undefined) {
      return validateDecision({
        action: introDecision.action,
        rationale: introDecision.rationale,
        confidence: 0.7,
        observedStateCitations: citations
      });
    }

    if (hasActiveTextBox(state)) {
      return validateDecision({
        action: press("A"),
        rationale: "Screen has an active non-empty text box, so advance text before any coordinate-based movement.",
        confidence: 0.7,
        observedStateCitations: citations
      });
    }

    const homeNavigation = chooseHomeNavigationAction(state, sameCoordRepeats);
    if (homeNavigation !== undefined) {
      return validateDecision({
        action: homeNavigation.action,
        rationale: homeNavigation.rationale,
        confidence: 0.68,
        observedStateCitations: citations
      });
    }

    if (isTextOrMenuActive(state)) {
      const action = shouldBackOutOfRepeatedText(state, sameCoordRepeats) ? press("B") : press("A");
      return validateDecision({
        action,
        rationale:
          action.button === "B"
            ? "Text or menu state appears repeated, so press B once to back out of a possible stale menu."
            : dialogProgressionRationale(state, sameCoordRepeats),
        confidence: 0.64,
        observedStateCitations: citations
      });
    }

    if (sameCoordRepeats >= REPEATED_STATE_THRESHOLD) {
      const button = chooseExploratoryButton(state, sameCoordRepeats);
      return validateDecision({
        action: press(button),
        rationale: "Overworld coordinates have repeated, so choose a local exploratory direction from the current state hash.",
        confidence: 0.56,
        observedStateCitations: citations
      });
    }

    return validateDecision({
      action: { type: "wait", frames: DEFAULT_WAIT_FRAMES },
      rationale: "No battle, text, menu, or repeated-coordinate signal is active, so wait briefly for the next observation.",
      confidence: 0.48,
      observedStateCitations: citations
    });
  }
}

export class HeuristicCommandPolicy implements CommandPolicy {
  async chooseAction(input: PolicyInput): Promise<CommandPolicyDecision> {
    const state = toStateSnapshot(input);

    if (isBattleState(state, input)) {
      return validateCommandDecision(chooseBattleCommand(input));
    }

    if (isDialogState(state, input)) {
      return validateCommandDecision({
        command: { type: "dialog", action: { kind: "advance" } },
        rationale: "Dialog or text is active, so advance it with the safest command fallback."
      });
    }

    const legacyDecision = await new HeuristicPolicy().chooseAction(input);
    return validateCommandDecision({
      command: legacyActionToRawCommand(legacyDecision.action),
      rationale: legacyDecision.rationale
    });
  }
}

function chooseBattleCommand(input: PolicyInput): CommandPolicyDecision {
  const battle = input.fullState?.battle;
  const partyMoves = input.fullState?.party.members[0]?.moves ?? [];
  const usableMove = partyMoves.find((move) => move.pp > 0);
  const firstMove = partyMoves[0];

  if (usableMove !== undefined) {
    return {
      command: { type: "battle", action: { kind: "fight", move: usableMove.name } },
      rationale: `Battle is active, so use the first move with PP remaining: ${usableMove.name}.`
    };
  }

  if (battle?.type === "wild") {
    return {
      command: { type: "battle", action: { kind: "run" } },
      rationale: "Wild battle is active and no usable move was found, so run as the safest fallback."
    };
  }

  if (firstMove !== undefined) {
    return {
      command: { type: "battle", action: { kind: "fight", move: firstMove.name } },
      rationale: `Battle is active, so fall back to the first known move: ${firstMove.name}.`
    };
  }

  return {
    command: { type: "battle", action: { kind: "run" } },
    rationale: "Battle is active but no moves were available, so run as a safe emergency fallback."
  };
}

function isBattleState(state: PokemonStateSnapshot, input: PolicyInput): boolean {
  return isInBattle(state) || input.fullState?.battle.inBattle === true;
}

function isDialogState(state: PokemonStateSnapshot, input: PolicyInput): boolean {
  return (
    input.fullState?.dialog.active === true ||
    state.menuActive === true ||
    state.textActive === true ||
    (state.wTextBoxID ?? state.textBoxId ?? 0) !== 0 ||
    typeof state.screenText === "string" && state.screenText.trim().length > 0
  );
}

function legacyActionToRawCommand(action: PolicyDecision["action"]): CommandPolicyDecision["command"] {
  switch (action.type) {
    case "press":
    case "hold":
      return {
        type: "raw",
        inputs: [{ button: action.button, frames: action.frames }],
        reason: "heuristic fallback"
      };
    case "wait":
      return {
        type: "raw",
        inputs: [{ button: "A", frames: action.frames }],
        reason: "heuristic fallback"
      };
    case "sequence":
      {
        const inputs = action.actions
          .flatMap((nestedAction) =>
            nestedAction.type === "press" || nestedAction.type === "hold"
              ? [{ button: nestedAction.button, frames: nestedAction.frames }]
              : []
          )
          .slice(0, 8);

        return {
          type: "raw",
          inputs: inputs.length > 0 ? inputs : [{ button: "A", frames: DEFAULT_PRESS_FRAMES }],
          reason: "heuristic fallback"
        };
      }
  }
}

function validateCommandDecision(decision: CommandPolicyDecision): CommandPolicyDecision {
  return CommandPolicyDecisionSchema.parse(decision);
}

function choosePostStarterOakLabAction(state: PokemonStateSnapshot): Pick<PolicyDecision, "action" | "rationale"> | undefined {
  if (getPartyCount(state) === 0 || state.wCurMap !== 40 || !isTextOrMenuActive(state)) {
    return undefined;
  }

  const screenText = typeof state.screenText === "string" ? state.screenText.trim() : "";
  if (screenText.length === 0 && state.wYCoord !== undefined && state.wXCoord !== undefined) {
    return {
      action: hold(chooseStepToward(state.wYCoord, state.wXCoord, 6, 5, "Down")),
      rationale: "Starter has been acquired and Oak Lab text flags are stale with no visible text, so walk toward y=6 to trigger the rival battle."
    };
  }

  return {
    action: press("A"),
    rationale: "Starter has been acquired in Oak Lab, so continue Oak/Rival text toward the rival battle instead of backing out."
  };
}

function chooseOakLabStarterAction(
  state: PokemonStateSnapshot,
  sameCoordRepeats: number
): Pick<PolicyDecision, "action" | "rationale"> | undefined {
  if (getPartyCount(state) !== 0 || state.wCurMap !== 40) {
    return undefined;
  }

  const y = state.wYCoord;
  const x = state.wXCoord;
  const screenText = typeof state.screenText === "string" ? state.screenText.trim() : "";

  if (screenText.includes("which POK") || screenText.includes("do you want")) {
    return {
      action: press("A"),
      rationale: "Oak is asking which starter to choose, so dismiss the prompt before turning toward the adjacent starter ball."
    };
  }

  if (screenText.length > 0) {
    return undefined;
  }

  if (y === 3 && x === 5 && sameCoordRepeats >= REPEATED_STATE_THRESHOLD && hasOakLabStarterStaleSignals(state)) {
    if (!isPlayerFacingRight(state)) {
      return {
        action: press("Right"),
        rationale: "Player is beside the Oak Lab starter ball but not facing right, so turn toward the starter before interacting."
      };
    }

    return {
      action: press("A"),
      rationale: "Player is beside the Oak Lab starter ball and facing right, so press A to select the adjacent starter."
    };
  }

  if (y !== undefined && x !== undefined && screenText.length === 0 && hasOakLabStarterStaleSignals(state)) {
    const button = chooseStepToward(y, x, 3, 5, "Right");
    return {
      action: hold(button),
      rationale: "Player is in Oak Lab without a starter, so move to the starter-ball interaction tile."
    };
  }

  return undefined;
}

function isPlayerFacingRight(state: PokemonStateSnapshot): boolean {
  if (state.playerFacingDirection === "right") {
    return true;
  }

  return state.wSpritePlayerStateData1FacingDirection === PLAYER_FACING_RIGHT;
}

function hasOakLabStarterStaleSignals(state: PokemonStateSnapshot): boolean {
  const textBoxId = state.wTextBoxID ?? state.textBoxId ?? 0;
  const menuItem = typeof state.wCurrentMenuItem === "number"
    ? state.wCurrentMenuItem
    : typeof state.menuItem === "number"
      ? state.menuItem
      : 0;
  const letterDelayFlags = typeof state.wLetterPrintingDelayFlags === "number"
    ? state.wLetterPrintingDelayFlags
    : typeof state.letterDelayFlags === "number"
      ? state.letterDelayFlags
      : 0;

  return textBoxId !== 0 && menuItem > 0 && letterDelayFlags !== 0;
}

function hasActiveTextBox(state: PokemonStateSnapshot): boolean {
  const textBoxId = typeof state.wTextBoxID === "number"
    ? state.wTextBoxID
    : typeof state.textBoxId === "number"
      ? state.textBoxId
      : 0;
  const screenText = typeof state.screenText === "string" ? state.screenText.trim() : "";

  return textBoxId !== 0 && screenText.length > 0;
}

function chooseIntroScreenAction(state: PokemonStateSnapshot): Pick<PolicyDecision, "action" | "rationale"> | undefined {
  const kind = typeof state.screenTextKind === "string" ? state.screenTextKind : "none";

  if (kind === "oak_intro") {
    return {
      action: press("A"),
      rationale: "Screen text is still Oak intro dialogue, so advance dialogue instead of trusting preloaded Red house coordinates."
    };
  }

  if (kind === "default_name_menu") {
    return {
      action: chooseDefaultNameMenuAction(state),
      rationale: "Screen text is a default-name menu, so choose a default name before attempting overworld movement."
    };
  }

  if (kind === "naming_screen") {
    return {
      action: chooseNamingScreenAction(state),
      rationale: "Screen text is a naming keyboard, so enter or submit a non-empty name before attempting overworld movement."
    };
  }

  return undefined;
}

function chooseDefaultNameMenuAction(state: PokemonStateSnapshot): PressAction {
  const menuItem = typeof state.wCurrentMenuItem === "number"
    ? state.wCurrentMenuItem
    : typeof state.menuItem === "number"
      ? state.menuItem
      : 0;

  return press(menuItem === 0 ? "Down" : "A");
}

function chooseNamingScreenAction(state: PokemonStateSnapshot): PressAction {
  const nameLength = typeof state.wNamingScreenNameLength === "number" ? state.wNamingScreenNameLength : 0;
  return press(nameLength === 0 ? "A" : "Start");
}

function toStateSnapshot(input: PolicyInput): PokemonStateSnapshot {
  if (input.state !== undefined) {
    return input.state;
  }

  if (isRecord(input.currentState)) {
    return input.currentState;
  }

  return {};
}

function isRecord(value: unknown): value is PokemonStateSnapshot {
  return typeof value === "object" && value !== null;
}

function press(button: MgbaButton): PressAction {
  return { type: "press", button, frames: DEFAULT_PRESS_FRAMES };
}

function hold(button: MgbaButton): HoldAction {
  return { type: "hold", button, frames: DEFAULT_HOLD_FRAMES };
}

function validateDecision(decision: PolicyDecision): PolicyDecision {
  return PolicyDecisionSchema.parse(decision);
}

function isInBattle(state: PokemonStateSnapshot): boolean {
  return state.wIsInBattle === true || (typeof state.wIsInBattle === "number" && state.wIsInBattle !== 0);
}

function isTextOrMenuActive(state: PokemonStateSnapshot): boolean {
  const textBoxId = state.wTextBoxID ?? state.textBoxId ?? 0;

  return state.menuActive === true || state.textActive === true || textBoxId !== 0;
}

function chooseHomeNavigationAction(
  state: PokemonStateSnapshot,
  sameCoordRepeats: number
): Pick<PolicyDecision, "action" | "rationale"> | undefined {
  if (getPartyCount(state) !== 0) {
    return undefined;
  }

  const mapId = state.wCurMap;
  const y = state.wYCoord;
  const x = state.wXCoord;
  const textBoxId = state.wTextBoxID ?? state.textBoxId ?? 0;
  const screenText = typeof state.screenText === "string" ? state.screenText.trim() : "";
  const menuItem = typeof state.wCurrentMenuItem === "number"
    ? state.wCurrentMenuItem
    : typeof state.menuItem === "number"
      ? state.menuItem
      : 0;
  const letterDelayFlags = typeof state.wLetterPrintingDelayFlags === "number"
    ? state.wLetterPrintingDelayFlags
    : typeof state.letterDelayFlags === "number"
      ? state.letterDelayFlags
      : 0;

  if (mapId === 38 && y !== undefined && x !== undefined) {
    if (isFreshRedHouseText(textBoxId, letterDelayFlags, menuItem, sameCoordRepeats, screenText)) {
      return {
        action: press("A"),
        rationale: "Player is in Red's upstairs room with fresh text visible, so advance it once before treating repeated text flags as stale."
      };
    }

    const button = chooseRedsHouse2fStep(y, x);
    return {
      action: hold(button),
      rationale: "Player is in Red's upstairs room before starter acquisition, so route toward the stair warp and ignore repeated stale text RAM."
    };
  }

  if (mapId === 37 && y !== undefined && x !== undefined) {
    if (isFreshRedHouseText(textBoxId, letterDelayFlags, menuItem, sameCoordRepeats, screenText)) {
      return {
        action: press("A"),
        rationale: "Player is in Red's downstairs room with fresh text visible, so advance it once before treating repeated text flags as stale."
      };
    }

    const button = chooseRedsHouse1fStep(y, x);
    return {
      action: hold(button),
      rationale: "Player is in Red's downstairs room before starter acquisition, so route toward the front-door warp and ignore repeated stale text RAM."
    };
  }


  if (mapId === 0 && y !== undefined && x !== undefined && !isBootTitleLikeZeroState(state)) {
    const button = chooseStepToward(y, x, 1, 10, "Up");
    return {
      action: hold(button),
      rationale: "Player is in Pallet Town before starter acquisition, so navigate locally toward the north grass trigger that starts Oak's lab flow."
    };
  }

  return undefined;
}

function isFreshRedHouseText(
  textBoxId: number,
  letterDelayFlags: number,
  menuItem: number,
  sameCoordRepeats: number,
  screenText: string
): boolean {
  return textBoxId !== 0 && screenText.length > 0 && (letterDelayFlags !== 0 || menuItem > 0) && sameCoordRepeats < RED_HOUSE_STALE_TEXT_REPEAT_THRESHOLD;
}

function chooseRedsHouse2fStep(y: number, x: number): MgbaButton {
  if (y > 1) {
    if (x < 5) {
      return "Right";
    }

    if (x > 5) {
      return "Left";
    }

    return "Up";
  }

  if (x < 7) {
    return "Right";
  }

  return "Right";
}

function chooseRedsHouse1fStep(y: number, x: number): MgbaButton {
  if (y >= 3) {
    if (x > 2) {
      return "Left";
    }

    if (x < 2) {
      return "Right";
    }

    return "Down";
  }

  if (y < 7) {
    if (x > 4) {
      return "Left";
    }

    if (x < 4) {
      return "Right";
    }

    return "Down";
  }

  if (x > 3) {
    return "Left";
  }

  if (x < 3) {
    return "Right";
  }

  if (y < 7) {
    return "Down";
  }

  return "Down";
}

function chooseStepToward(
  currentY: number,
  currentX: number,
  targetY: number,
  targetX: number,
  finalButton: MgbaButton
): MgbaButton {
  if (currentX < targetX) {
    return "Right";
  }

  if (currentX > targetX) {
    return "Left";
  }

  if (currentY < targetY) {
    return "Down";
  }

  if (currentY > targetY) {
    return "Up";
  }

  return finalButton;
}

function shouldBackOutOfRepeatedText(state: PokemonStateSnapshot, sameCoordRepeats: number): boolean {
  return sameCoordRepeats >= REPEATED_STATE_THRESHOLD && getPartyCount(state) > 0;
}

function dialogProgressionRationale(state: PokemonStateSnapshot, sameCoordRepeats: number): string {
  if (sameCoordRepeats >= REPEATED_STATE_THRESHOLD && getPartyCount(state) === 0) {
    return "Repeated text appears before starter acquisition, so press A to continue intro or Oak dialog instead of backing out.";
  }

  return "Text or menu state appears active, so press A to advance the current prompt.";
}

function getPartyCount(state: PokemonStateSnapshot): number {
  return state.wPartyCount ?? state.partyCount ?? 0;
}

function isBootTitleLikeZeroState(state: PokemonStateSnapshot): boolean {
  return (
    state.wCurMap === 0 &&
    state.wYCoord === 0 &&
    state.wXCoord === 0 &&
    getPartyCount(state) === 0 &&
    state.wIsInBattle === 0 &&
    (state.wTextBoxID ?? state.textBoxId) === 0
  );
}

function countBootTitleRepeats(state: PokemonStateSnapshot, recentStates: readonly RecentStateSnapshot[]): number {
  if (!isBootTitleLikeZeroState(state)) {
    return 0;
  }

  let repeats = 0;
  for (let index = recentStates.length - 1; index >= 0; index -= 1) {
    if (!isBootTitleLikeZeroState(recentStates[index])) {
      break;
    }

    repeats += 1;
  }

  return repeats;
}

function chooseBootTitleButton(bootTitleRepeats: number): "Start" | "A" {
  return bootTitleRepeats % 2 === 0 ? "Start" : "A";
}

function countSameCoordinateRepeats(state: PokemonStateSnapshot, recentStates: readonly RecentStateSnapshot[]): number {
  if (state.wCurMap === undefined || state.wYCoord === undefined || state.wXCoord === undefined) {
    return 0;
  }

  let repeats = 0;
  for (let index = recentStates.length - 1; index >= 0; index -= 1) {
    const recentState = recentStates[index];
    if (
      recentState.wCurMap !== state.wCurMap ||
      recentState.wYCoord !== state.wYCoord ||
      recentState.wXCoord !== state.wXCoord
    ) {
      break;
    }

    repeats += 1;
  }

  return repeats;
}

function chooseExploratoryButton(
  state: PokemonStateSnapshot,
  sameCoordRepeats: number
): (typeof EXPLORATORY_BUTTONS)[number] {
  const hash = [state.wCurMap ?? 0, state.wYCoord ?? 0, state.wXCoord ?? 0, sameCoordRepeats].reduce(
    (total, value) => total * 31 + value,
    7
  );

  return EXPLORATORY_BUTTONS[Math.abs(hash) % EXPLORATORY_BUTTONS.length];
}

function buildObservedStateCitations(
  state: PokemonStateSnapshot,
  sameCoordRepeats: number,
  bootTitleRepeats: number
): string[] {
  const partyCount = getPartyCount(state);
  const textBoxId = state.wTextBoxID ?? state.textBoxId ?? 0;
  const bootTitleSignal = isBootTitleLikeZeroState(state);

  return [
    `wIsInBattle=${formatStateValue(state.wIsInBattle ?? 0)}`,
    `partyCount=${partyCount}`,
    `wTextBoxID=${textBoxId}`,
    `coords=${state.wCurMap ?? "unknown"}:${state.wYCoord ?? "unknown"}:${state.wXCoord ?? "unknown"}`,
    `sameCoordRepeats=${sameCoordRepeats};bootTitleZeroSignal=${bootTitleSignal ? "true" : "false"};bootTitleRepeats=${bootTitleRepeats}`
  ];
}

function formatStateValue(value: number | boolean): string {
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  return String(value);
}
