import type { BagItem, BattleState, FullGameState, MoveSlot, PartyPokemon } from "./PokemonTypes.js";

const SEPARATOR = "==================================================";

export function buildStateSummary(state: FullGameState, mapAscii?: string, visitedMaps?: number[]): string {
  const lines: string[] = [
    SEPARATOR,
    "GAME STATE",
    SEPARATOR,
    `Location  : ${state.map.mapName} (map ${state.map.mapId})`,
    `Position  : y=${state.player.position.y} x=${state.player.position.x}, facing ${state.player.facing.direction}`,
    `Badges    : ${formatBadges(state.player.badges)}`,
    `Money     : $${state.player.money}`,
    `Playtime  : ${state.player.playTime}`,
    "",
    `--- PARTY (${state.party.count}/6) ---`,
    ...formatParty(state.party.members),
    "",
    ...formatBattle(state.battle, state.party.members[0]),
    "",
    "--- DIALOG ---",
    formatDialog(state),
    "",
    `--- BAG (${state.bag.length} items) ---`,
    ...formatBag(state.bag),
    "",
    "--- FLAGS ---",
    `Has Pokedex   : ${yesNo(state.flags.hasPokedex)}`,
    `Pokedex owned : ${state.flags.pokedexOwned}`,
    `Pokedex seen  : ${state.flags.pokedexSeen}`,
    "",
    "--- MAP ---",
    ...(mapAscii !== undefined && mapAscii.trim().length > 0 ? [mapAscii.trimEnd()] : ["No map memory available."]),
    "",
    `Adjacent tiles: ${formatAdjacentTiles(state, mapAscii)}`,
    `Visited maps: [${(visitedMaps ?? []).join(", ")}]`,
    SEPARATOR
  ];

  return lines.join("\n");
}

function formatBadges(badges: FullGameState["player"]["badges"]): string {
  const names = badges.names.length > 0 ? badges.names.join(", ") : "none";
  return `${badges.count} — ${names}`;
}

function formatParty(members: readonly PartyPokemon[]): string[] {
  if (members.length === 0) {
    return ["  none"];
  }

  return members.flatMap((pokemon, index) => [
    `  ${index + 1}. ${pokemon.nickname} (${pokemon.species} Lv${pokemon.level})  HP ${pokemon.hp}/${pokemon.maxHp}  Status: ${pokemon.status}`,
    `     Moves: ${formatMoveSlots(pokemon.moves)}`
  ]);
}

function formatMoveSlots(moves: readonly MoveSlot[]): string {
  if (moves.length === 0) {
    return "none";
  }

  return moves.map((move) => {
    const pp = move.maxPp === undefined ? String(move.pp) : `${move.pp}/${move.maxPp}`;
    return `${move.name} (PP ${pp})`;
  }).join(", ");
}

function formatBattle(battle: BattleState, lead?: PartyPokemon): string[] {
  if (!battle.inBattle || battle.type === "none") {
    return ["--- BATTLE ---", "Not in battle."];
  }

  const lines = [`--- BATTLE (${battle.type}) ---`];
  if (battle.enemy) {
    lines.push(
      `Enemy: ${battle.enemy.species} Lv${battle.enemy.level}  HP ${battle.enemy.hp}/${battle.enemy.maxHp}  Status: ${battle.enemy.status}`,
      `Enemy moves: ${battle.enemy.moves.length > 0 ? formatMoveSlots(battle.enemy.moves) : "unknown"}`
    );
  } else {
    lines.push("Enemy: unknown");
  }

  if (lead) {
    lines.push(
      "",
      `Your lead: ${lead.nickname} Lv${lead.level}  HP ${lead.hp}/${lead.maxHp}`,
      `  Moves: ${formatMoveSlots(lead.moves)}`
    );
  }

  return lines;
}

function formatDialog(state: FullGameState): string {
  if (!state.dialog.active) {
    return "No active dialog.";
  }

  const text = state.menuText.screenText.trim();
  return text.length > 0 ? text : `Active dialog (textBoxId ${state.dialog.textBoxId}).`;
}

function formatBag(items: readonly BagItem[]): string[] {
  if (items.length === 0) {
    return ["  empty"];
  }

  return items.map((item) => `  ${item.name} x${item.quantity}`);
}

function formatAdjacentTiles(state: FullGameState, mapAscii?: string): string {
  const grid = parseAsciiGrid(mapAscii);
  if (grid === undefined) {
    return "unknown";
  }

  const y = state.player.position.y;
  const x = state.player.position.x;
  if (tileAt(grid, y, x) === undefined) {
    return "unknown (player position is outside current map-memory bounds)";
  }

  return [
    ["Up", y - 1, x],
    ["Down", y + 1, x],
    ["Left", y, x - 1],
    ["Right", y, x + 1]
  ].map(([direction, tileY, tileX]) => `${direction}:${tileStatus(grid, Number(tileY), Number(tileX))}`).join(", ");
}

function parseAsciiGrid(mapAscii?: string): string[][] | undefined {
  if (mapAscii === undefined || mapAscii.trim().length === 0) {
    return undefined;
  }

  const rows = mapAscii
    .split("\n")
    .map((line) => line.match(/^\s*\d+\s+([.#"?@NW]+)\s*$/)?.[1])
    .filter((row): row is string => row !== undefined);

  if (rows.length > 0) {
    return rows.map((line) => [...line]);
  }

  return mapAscii.split("\n").map((line) => [...line]);
}

function tileStatus(grid: string[][], y: number, x: number): "open" | "blocked" | "unknown" {
  const tile = tileAt(grid, y, x);
  if (tile === undefined || tile === "?") {
    return "unknown";
  }
  return ["#", "N"].includes(tile) ? "blocked" : "open";
}

function tileAt(grid: string[][], y: number, x: number): string | undefined {
  return grid[y]?.[x];
}

function yesNo(value: boolean): "yes" | "no" {
  return value ? "yes" : "no";
}
