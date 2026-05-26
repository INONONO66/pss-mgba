import type { BattleAction, Command, CommandHistoryEntry, CommandResult, DialogAction, GameMode } from "../control/CommandTypes.js";
import type { FullGameState } from "../pokemon/PokemonTypes.js";
import type { PolicyInput, PokemonStateSnapshot } from "./PromptTypes.js";
import { buildBattleContext } from "./prompts/battle.js";
import { buildDialogContext } from "./prompts/dialog.js";
import { buildGameKnowledge } from "./prompts/game-knowledge.js";
import { buildOverworldContext } from "./prompts/overworld.js";

export function buildSystemPrompt(mode: GameMode): string {
  return buildGameKnowledge() + "\n\n" + buildModeContext(mode);
}

function buildModeContext(mode: GameMode): string {
  switch (mode) {
    case "overworld":
      return buildOverworldContext();
    case "battle":
      return buildBattleContext();
    case "dialog":
      return buildDialogContext();
    default: {
      const exhaustiveMode: never = mode;
      return exhaustiveMode;
    }
  }
}

export function buildUserMessage(input: PolicyInput): string {
  const mode = input.mode ?? inferMode(input);
  const sections = [
    buildProgressSection(input),
    buildAdviserHintSection(input),
    buildLastResultSection(input),
    buildStateSection(input, mode),
    ...(mode === "overworld" ? buildMapSections(input) : []),
    buildHistorySection(input.commandHistory)
  ].filter((section): section is string => section !== undefined && section.trim().length > 0);

  return sections.join("\n\n");
}

function buildProgressSection(input: PolicyInput): string {
  const badges = getBadgeProgress(input);
  const names = badges.names.length > 0 ? ` (${badges.names.join(", ")})` : "";
  return `[PROGRESS]\nBadges: ${badges.count}/8${names}. Step ${input.step ?? 0}.`;
}

function buildAdviserHintSection(input: PolicyInput): string | undefined {
  if (input.adviserHint === undefined || input.adviserHint.trim().length === 0) return undefined;
  return `[ADVISER HINT]\n${input.adviserHint}`;
}

function buildLastResultSection(input: PolicyInput): string | undefined {
  if (input.lastResult === undefined) return undefined;
  const latestCommand = input.commandHistory === undefined || input.commandHistory.length === 0
    ? undefined
    : input.commandHistory[input.commandHistory.length - 1].command;
  return `[LAST RESULT]\n${formatCommandOrUnknown(latestCommand)} → ${formatResult(input.lastResult)}`;
}

function buildStateSection(input: PolicyInput, mode: GameMode): string {
  const body = mode === "battle"
    ? buildBattleState(input)
    : mode === "dialog"
      ? buildDialogState(input)
      : buildOverworldState(input);
  return `[STATE: ${mode.toUpperCase()}]\n${body}`;
}

function buildOverworldState(input: PolicyInput): string {
  const fullState = input.fullState;
  const state = input.state;
  if (fullState !== undefined) {
    return [
      `Location: ${fullState.map.mapName} (map ${fullState.map.mapId}), pos (${fullState.player.position.x},${fullState.player.position.y}), facing ${fullState.player.facing.direction}`,
      `Party: ${formatParty(fullState)}`,
      `Bag: ${formatBag(fullState)}`
    ].join("\n");
  }

  const mapName = pickStringFrom(state, "mapName") ?? "Unknown";
  const mapId = pickNumber(state?.wCurMap, pickNumberFrom(state, "mapId")) ?? "?";
  const x = pickNumber(state?.wXCoord, pickNumberFrom(state, "x")) ?? "?";
  const y = pickNumber(state?.wYCoord, pickNumberFrom(state, "y")) ?? "?";
  const facing = pickString(state?.playerFacingDirection, pickStringFrom(state, "facing")) ?? "unknown";
  return [
    `Location: ${mapName} (map ${mapId}), pos (${x},${y}), facing ${facing}`,
    `Party: ${formatFallbackParty(state)}`,
    `Bag: ${formatFallbackBag(state)}`
  ].join("\n");
}

function buildBattleState(input: PolicyInput): string {
  const fullState = input.fullState;
  if (fullState === undefined) {
    return buildFallbackBattleState(input.state);
  }

  const enemy = fullState.battle.enemy;
  const active = fullState.party.members[0];
  const lines = [
    `Type: ${fullState.battle.type}`,
    enemy === undefined ? "Enemy: unknown" : `Enemy: ${enemy.species} Lv${enemy.level} (${formatTypes(enemy.types)}) HP ${enemy.hp}/${enemy.maxHp}`,
    `  Known moves: ${enemy === undefined ? "unknown" : formatMoveNames(enemy.moves)}`,
    "",
    active === undefined ? "Your pokemon: unknown" : `Your pokemon: ${formatPokemonName(active)} Lv${active.level} HP ${active.hp}/${active.maxHp}`,
    "  Moves:",
    ...(active === undefined || active.moves.length === 0 ? ["    - unknown"] : active.moves.map(formatMove)),
    `Bag: ${formatBag(fullState)}`,
    `Can run: ${fullState.battle.type === "wild" ? "yes" : "no"}`,
    `Party: ${formatParty(fullState)}`
  ];
  return lines.join("\n");
}

function buildDialogState(input: PolicyInput): string {
  const text = input.fullState?.menuText.screenText ?? pickStringFrom(input.state, "screenText") ?? pickStringFrom(input.currentState, "screenText") ?? "";
  const choices = getChoices(input);
  const lines = [`Screen text: "${text}"`];
  if (choices.length > 0) {
    lines.push(`Choices: [${choices.join(", ")}]`);
  }
  return lines.join("\n");
}

function buildFallbackBattleState(state: PokemonStateSnapshot | undefined): string {
  const record = toRecord(state);
  const enemy = toRecord(record?.enemy);
  const active = toRecord(record?.activePokemon) ?? toRecord(record?.playerPokemon) ?? toRecord(record?.pokemon);
  const battleType = pickStringFrom(state, "battleType") ?? (state?.wIsInBattle === 1 ? "wild" : "unknown");
  return [
    `Type: ${battleType}`,
    `Enemy: ${formatFallbackPokemon(enemy)}`,
    `  Known moves: ${formatUnknownMoveNames(enemy?.moves)}`,
    "",
    `Your pokemon: ${formatFallbackPokemon(active)}`,
    "  Moves:",
    ...formatFallbackMoves(active?.moves),
    `Bag: ${formatFallbackBag(state)}`,
    `Can run: ${battleType === "wild" ? "yes" : "no"}`,
    `Party: ${formatFallbackParty(state)}`
  ].join("\n");
}

function buildMapSections(input: PolicyInput): string[] {
  const sections: string[] = [];
  if (input.mapGraph !== undefined && input.mapGraph.trim().length > 0) {
    sections.push(withHeader("[MAP GRAPH]", input.mapGraph));
  }
  if (input.currentMapFull !== undefined && input.currentMapFull.trim().length > 0) {
    sections.push(withHeader("[CURRENT MAP]", input.currentMapFull));
  }
  if (input.microContext !== undefined) {
    const adjacent = Object.entries(input.microContext.adjacent)
      .map(([direction, value]) => `${capitalize(direction)}:${value}`)
      .join(", ");
    const lines = [
      `Position: (${input.microContext.position.x},${input.microContext.position.y}), facing ${input.microContext.facing}`,
      `Adjacent: ${adjacent}`,
    ];
    if (input.microContext.warps !== undefined && input.microContext.warps.length > 0) {
      lines.push(`Warps: ${input.microContext.warps.map((w) => `(${w.x},${w.y})→${w.destMapName}`).join(", ")}`);
    }
    if (input.microContext.npcs !== undefined && input.microContext.npcs.length > 0) {
      lines.push(`NPCs: ${input.microContext.npcs.map((n) => `#${n.slot} at (${n.mapX},${n.mapY}) facing ${n.facing} [${n.movementType}]`).join(", ")}`);
    }
    sections.push(lines.join("\n"));
  }
  return sections;
}

function buildHistorySection(history: CommandHistoryEntry[] | undefined): string | undefined {
  if (history === undefined || history.length === 0) return undefined;
  return `[HISTORY]\n${history.slice(-10).map(formatHistoryEntry).join("\n")}`;
}

function formatHistoryEntry(entry: CommandHistoryEntry): string {
  const cmd = formatCommand(entry.command);
  const result = `${entry.result.status}: ${entry.result.reason}`;
  const details = entry.result.details ? ` (${entry.result.details})` : "";
  return `[${entry.step}] ${cmd} → ${result}${details}`;
}

function formatCommand(command: Command): string {
  switch (command.type) {
    case "navigate":
      return `navigate(${command.x},${command.y})`;
    case "interact":
      return command.direction ? `interact(${command.direction})` : "interact()";
    case "dialog":
      return `dialog(${formatDialogAction(command.action)})`;
    case "battle":
      return `battle(${formatBattleAction(command.action)})`;
    case "wait":
      return `wait(${command.frames})`;
    case "raw":
      return `raw(${command.inputs.length} inputs)`;
  }
}

function formatDialogAction(action: DialogAction): string {
  switch (action.kind) {
    case "advance":
      return "advance";
    case "choose":
      return `choose:${action.index}`;
    case "input_name":
      return `input_name:"${action.name}"`;
  }
}

function formatBattleAction(action: BattleAction): string {
  switch (action.kind) {
    case "fight":
      return `fight:"${action.move}"`;
    case "item":
      return `item:"${action.item}"`;
    case "switch":
      return `switch:"${action.pokemon}"`;
    case "run":
      return "run";
  }
}

function formatCommandOrUnknown(command: Command | undefined): string {
  return command === undefined ? "unknown" : formatCommand(command);
}

function formatResult(result: CommandResult): string {
  const details = result.details ? ` (${result.details})` : "";
  return `${result.status}: ${result.reason}${details}`;
}

function getBadgeProgress(input: PolicyInput): { count: number; names: string[] } {
  const fullBadges = input.fullState?.flags.badges ?? input.fullState?.player.badges;
  if (fullBadges !== undefined) {
    return { count: fullBadges.count, names: [...fullBadges.names] };
  }
  const count = pickNumber(input.state?.badgeCount, input.state?.wObtainedBadges, pickNumberFrom(input.state, "badges")) ?? 0;
  const names = readStringArray(toRecord(input.state)?.badgeNames);
  return { count, names };
}

function inferMode(input: PolicyInput): GameMode {
  if (input.fullState?.battle.inBattle === true || input.state?.wIsInBattle === 1 || input.state?.wIsInBattle === true) return "battle";
  if (input.fullState?.dialog.active === true || input.state?.textActive === true || input.state?.menuActive === true) return "dialog";
  return "overworld";
}

function formatParty(state: FullGameState): string {
  if (state.party.members.length === 0) return "empty";
  return state.party.members.map((pokemon) => `${formatPokemonName(pokemon)} Lv${pokemon.level} HP ${pokemon.hp}/${pokemon.maxHp}`).join(", ");
}

function formatBag(state: FullGameState): string {
  if (state.bag.length === 0) return "empty";
  return state.bag.map((item) => `${item.name} x${item.quantity}`).join(", ");
}

function formatMove(move: FullGameState["party"]["members"][number]["moves"][number]): string {
  const type = pickStringFrom(move, "type");
  const typePrefix = type === undefined ? "" : `${type}, `;
  const pp = move.maxPp === undefined ? `${move.pp}/?` : `${move.pp}/${move.maxPp}`;
  const empty = move.pp === 0 ? " ← EMPTY" : "";
  return `    - ${move.name} (${typePrefix}PP ${pp})${empty}`;
}

function formatMoveNames(moves: readonly { readonly name: string }[]): string {
  return moves.length === 0 ? "unknown" : moves.map((move) => move.name).join(", ");
}

function formatTypes(types: readonly string[]): string {
  return types.filter((type, index, values) => type.length > 0 && values.indexOf(type) === index).join("/") || "unknown";
}

function formatPokemonName(pokemon: { readonly nickname?: string; readonly species?: string }): string {
  return pokemon.nickname !== undefined && pokemon.nickname.length > 0 ? pokemon.nickname : pokemon.species ?? "unknown";
}

function formatFallbackParty(state: PokemonStateSnapshot | undefined): string {
  const party = toRecord(state)?.party;
  const partyMembers = toRecord(party)?.members;
  const members = Array.isArray(partyMembers) ? partyMembers : Array.isArray(party) ? party : undefined;
  if (members === undefined || members.length === 0) {
    const count = pickNumber(state?.wPartyCount, state?.partyCount);
    return count === undefined ? "unknown" : `${count} pokemon`;
  }
  return members.map((member) => formatFallbackPokemon(toRecord(member))).join(", ");
}

function formatFallbackBag(state: PokemonStateSnapshot | undefined): string {
  const bag = toRecord(state)?.bag;
  if (!Array.isArray(bag) || bag.length === 0) return "empty";
  return bag.map((item) => {
    const record = toRecord(item);
    const name = pickStringFrom(record, "name") ?? "unknown";
    const quantity = pickNumberFrom(record, "quantity") ?? pickNumberFrom(record, "count") ?? "?";
    return `${name} x${quantity}`;
  }).join(", ");
}

function formatFallbackPokemon(pokemon: Record<string, unknown> | undefined): string {
  if (pokemon === undefined) return "unknown";
  const name = pickStringFrom(pokemon, "nickname") ?? pickStringFrom(pokemon, "species") ?? pickStringFrom(pokemon, "name") ?? "unknown";
  const level = pickNumberFrom(pokemon, "level");
  const hp = pickNumberFrom(pokemon, "hp") ?? pickNumberFrom(pokemon, "currentHp");
  const maxHp = pickNumberFrom(pokemon, "maxHp");
  const types = readStringArray(pokemon.types);
  const typeText = types.length > 0 ? ` (${formatTypes(types)})` : "";
  const levelText = level === undefined ? "" : ` Lv${level}`;
  const hpText = hp === undefined ? "" : ` HP ${hp}/${maxHp ?? "?"}`;
  return `${name}${levelText}${typeText}${hpText}`;
}

function formatFallbackMoves(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return ["    - unknown"];
  return value.map((item) => {
    const move = toRecord(item);
    const name = pickStringFrom(move, "name") ?? "unknown";
    const type = pickStringFrom(move, "type");
    const pp = pickNumberFrom(move, "pp") ?? pickNumberFrom(move, "currentPp");
    const maxPp = pickNumberFrom(move, "maxPp");
    const typePrefix = type === undefined ? "" : `${type}, `;
    const ppText = pp === undefined ? "PP ?/?" : `PP ${pp}/${maxPp ?? "?"}`;
    const empty = pp === 0 ? " ← EMPTY" : "";
    return `    - ${name} (${typePrefix}${ppText})${empty}`;
  });
}

function formatUnknownMoveNames(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "unknown";
  return value.map((item) => pickStringFrom(item, "name") ?? String(item)).join(", ");
}

function getChoices(input: PolicyInput): string[] {
  const candidates = [
    toRecord(input.state)?.choices,
    toRecord(input.state)?.dialogChoices,
    toRecord(input.currentState)?.choices,
    toRecord(input.currentState)?.dialogChoices
  ];
  for (const candidate of candidates) {
    const choices = readStringArray(candidate);
    if (choices.length > 0) return choices;
  }
  return [];
}

function withHeader(header: string, value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("[") ? trimmed : `${header}\n${trimmed}`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function pickNumber(...values: readonly unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function pickString(...values: readonly unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function pickNumberFrom(value: unknown, key: string): number | undefined {
  const record = toRecord(value);
  const candidate = record?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function pickStringFrom(value: unknown, key: string): string | undefined {
  const record = toRecord(value);
  const candidate = record?.[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}
