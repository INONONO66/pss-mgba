import type { BattleCommand, CommandResult } from "../control/CommandTypes.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";
import type { FullGameState } from "../pokemon/PokemonTypes.js";

const QUICK_FRAMES = 5;
const MENU_TRANSITION_FRAMES = 15;

export interface BattleController {
  pressButton(button: MgbaButton, frames?: number): Promise<void>;
}

export interface BattleStateReader {
  readBattleState(): Promise<{ inBattle: boolean; menuActive: boolean }>;
}

export async function executeBattle(
  command: BattleCommand,
  controller: BattleController,
  fullState: FullGameState,
): Promise<CommandResult> {
  switch (command.action.kind) {
    case "fight":
      return executeFight(command.action.move, controller, fullState);
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
  return {
    status: "success",
    reason: "move_used",
    details: `Used ${selectedMove.name}`,
  };
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

function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
