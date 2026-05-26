import type { BattleCommand, Command, CommandResult } from "../control/CommandTypes.js";
import type { FullGameState } from "../game/PokemonTypes.js";

export interface GuardContext {
  fullState: FullGameState;
  mapWidth: number;
  mapHeight: number;
}

export type GuardResult =
  | { valid: true }
  | { valid: false; result: CommandResult };

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function formatMove(move: { name: string; pp: number; maxPp?: number }): string {
  if (move.maxPp !== undefined) {
    return `${move.name} (PP ${move.pp}/${move.maxPp})`;
  }
  return `${move.name} (PP ${move.pp})`;
}

function formatBagItem(item: { name: string; quantity: number }): string {
  return `${item.name} x${item.quantity}`;
}

function reject(reason: string, details: string): GuardResult {
  return { valid: false, result: { status: "rejected", reason, details } };
}

function validateBattleCommand(command: BattleCommand, context: GuardContext): GuardResult {
  const action = command.action;

  switch (action.kind) {
    case "fight": {
      const moves = context.fullState.party.members[0]?.moves ?? [];
      const targetName = normalizeName(action.move);
      const move = moves.find((entry) => normalizeName(entry.name) === targetName);

      if (!move) {
        const available = moves.map((entry) => entry.name).join(", ") || "None";
        return reject("move_not_found", `Move '${action.move}' not found. Available: ${available}`);
      }

      if (move.pp === 0) {
        const availableWithPp = moves.filter((entry) => entry.pp > 0).map(formatMove).join(", ") || "None";
        return reject("no_pp", `${move.name} has 0 PP. Available moves with PP: ${availableWithPp}`);
      }

      return { valid: true };
    }
    case "item": {
      const targetName = normalizeName(action.item);
      const item = context.fullState.bag.find((entry) => normalizeName(entry.name) === targetName);

      if (!item || item.quantity === 0) {
        const bagContents = context.fullState.bag.map(formatBagItem).join(", ") || "empty";
        return reject("item_not_in_bag", `${action.item} not in bag. Bag: ${bagContents}`);
      }

      return { valid: true };
    }
    case "switch": {
      const targetName = normalizeName(action.pokemon);
      const members = context.fullState.party.members;
      const memberIndex = members.findIndex((entry) => normalizeName(entry.nickname) === targetName);

      if (memberIndex < 0) {
        const available = members.map((entry) => entry.nickname).join(", ") || "None";
        return reject("pokemon_not_found", `Pokemon '${action.pokemon}' not found. Available: ${available}`);
      }

      const pokemon = members[memberIndex];
      if (pokemon.hp === 0) {
        return reject("pokemon_fainted", `${pokemon.nickname} has fainted. Choose a non-fainted party member.`);
      }

      if (memberIndex === 0) {
        return reject("already_active", `${pokemon.nickname} is already active.`);
      }

      return { valid: true };
    }
    case "run":
      if (context.fullState.battle.type === "trainer") {
        return reject("cannot_run_trainer", "Cannot run from a trainer battle.");
      }
      return { valid: true };
  }
}

function validateNavigateCommand(command: Extract<Command, { type: "navigate" }>, context: GuardContext): GuardResult {
  if (command.x < 0 || command.x >= context.mapWidth || command.y < 0 || command.y >= context.mapHeight) {
    return reject(
      "invalid_target",
      `Target (${command.x}, ${command.y}) is outside bounds 0..${context.mapWidth - 1}, 0..${context.mapHeight - 1}.`,
    );
  }

  return { valid: true };
}

export function validateCommand(command: Command, context: GuardContext): GuardResult {
  switch (command.type) {
    case "battle":
      return validateBattleCommand(command, context);
    case "navigate":
      return validateNavigateCommand(command, context);
    case "interact":
    case "dialog":
    case "wait":
    case "raw":
      return { valid: true };
  }
}
