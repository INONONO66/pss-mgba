import type { BattleCommand, CommandResult } from "../control/CommandTypes.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";
import type { FullGameState } from "../game/PokemonTypes.js";
import type { DialogStateReader } from "./DialogExecutor.js";

const QUICK_FRAMES = 5;
const MENU_TRANSITION_FRAMES = 15;
const NARRATION_PRESS_FRAMES = 16;
const MAX_NARRATION_PRESSES = 60;
const TILE_FIGHT_ARROW = 0xed;

// FIGHT arrow appears at row 14, col 9 (tilemap offset 14*20+9 = 289)
const BATTLE_MENU_ARROW_OFFSET = 14 * 20 + 9;

export interface BattleController {
  pressButton(button: MgbaButton, frames?: number): Promise<void>;
}

export async function executeBattle(
  command: BattleCommand,
  controller: BattleController,
  fullState: FullGameState,
  dialogStateReader?: DialogStateReader,
): Promise<CommandResult> {
  switch (command.action.kind) {
    case "fight":
      return executeFight(command.action.move, controller, fullState, dialogStateReader);
    case "item":
      return executeItem(command.action.item, controller, fullState);
    case "switch":
      return executeSwitch(command.action.pokemon, controller, fullState);
    case "run":
      return executeRun(controller);
  }
}

async function executeFight(
  moveName: string,
  controller: BattleController,
  fullState: FullGameState,
  dialogStateReader?: DialogStateReader,
): Promise<CommandResult> {
  await navigateTopMenu(controller, ["Up", "Left"]);

  const activePokemon = fullState.party.members[0];
  const moveIndex = activePokemon?.moves.findIndex((move) => sameName(move.name, moveName)) ?? -1;
  if (moveIndex < 0) {
    return { status: "failed", reason: "move_not_found", details: `Move ${moveName} was not found` };
  }

  for (let step = 0; step < moveIndex; step += 1) {
    await controller.pressButton("Down", QUICK_FRAMES);
  }
  await controller.pressButton("A", MENU_TRANSITION_FRAMES);

  const selectedMove = activePokemon.moves[moveIndex];

  if (dialogStateReader === undefined) {
    return { status: "success", reason: "move_used", details: `Used ${selectedMove.name}` };
  }

  const narration = await advanceBattleNarration(controller, dialogStateReader);

  const battleEnded = !(await dialogStateReader.isInBattle());
  const reason = battleEnded ? "battle_ended" : "move_used";

  return {
    status: "success",
    reason,
    details: `Used ${selectedMove.name}${narration.length > 0 ? `; transcript=${JSON.stringify(narration)}` : ""}`,
  };
}

async function advanceBattleNarration(
  controller: BattleController,
  stateReader: DialogStateReader,
): Promise<string[]> {
  const transcript: string[] = [];
  let previousText = "";

  for (let presses = 0; presses < MAX_NARRATION_PRESSES; presses += 1) {
    const [windowVisible, inBattle, screenText] = await Promise.all([
      stateReader.isWindowVisible(),
      stateReader.isInBattle(),
      stateReader.readScreenText(),
    ]);

    if (windowVisible && screenText === previousText) {
      recordPage(transcript, screenText);
    }
    previousText = screenText;

    if (!inBattle) {
      recordPage(transcript, screenText);
      return transcript;
    }

    if (await isBattleMenuVisible(stateReader)) {
      return transcript;
    }

    await controller.pressButton("A", NARRATION_PRESS_FRAMES);
  }

  return transcript;
}

async function isBattleMenuVisible(stateReader: DialogStateReader): Promise<boolean> {
  const tileMapByte = await stateReader.readTileAt(BATTLE_MENU_ARROW_OFFSET);
  return tileMapByte === TILE_FIGHT_ARROW;
}

async function executeItem(
  itemName: string,
  controller: BattleController,
  fullState: FullGameState,
): Promise<CommandResult> {
  await navigateTopMenu(controller, ["Up", "Right"]);
  await controller.pressButton("A", MENU_TRANSITION_FRAMES);

  const selectedItem = fullState.bag.find((item) => sameName(item.name, itemName));
  return {
    status: "success",
    reason: "item_used",
    details: `Used ${selectedItem?.name ?? itemName}`,
  };
}

async function executeSwitch(
  pokemonName: string,
  controller: BattleController,
  fullState: FullGameState,
): Promise<CommandResult> {
  await navigateTopMenu(controller, ["Down", "Left"]);

  const pokemonIndex = fullState.party.members.findIndex((pokemon) => sameName(pokemon.nickname, pokemonName));
  if (pokemonIndex < 0) {
    return { status: "failed", reason: "pokemon_not_found", details: `Pokemon ${pokemonName} was not found` };
  }

  for (let step = 0; step < pokemonIndex; step += 1) {
    await controller.pressButton("Down", QUICK_FRAMES);
  }
  await controller.pressButton("A", MENU_TRANSITION_FRAMES);

  const selectedPokemon = fullState.party.members[pokemonIndex];
  return {
    status: "success",
    reason: "pokemon_switched",
    details: `Switched to ${selectedPokemon.nickname}`,
  };
}

async function executeRun(controller: BattleController): Promise<CommandResult> {
  await navigateTopMenu(controller, ["Down", "Right"]);

  return {
    status: "success",
    reason: "fled",
    details: "Attempted to flee",
  };
}

async function navigateTopMenu(controller: BattleController, buttons: readonly MgbaButton[]): Promise<void> {
  for (const button of buttons) {
    await controller.pressButton(button, QUICK_FRAMES);
  }
  await controller.pressButton("A", MENU_TRANSITION_FRAMES);
}

function recordPage(transcript: string[], screenText: string): void {
  const trimmed = screenText.trim();
  if (trimmed.length === 0) {
    return;
  }
  if (transcript.at(-1) === trimmed) {
    return;
  }
  transcript.push(trimmed);
}

function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
