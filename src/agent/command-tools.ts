import type { AgentTool, AgentTools } from "@minpeter/pss-runtime";
import { z } from "zod";
import type {
  BattleAction,
  Command,
  CommandResult,
  DialogAction,
  Direction,
  GameMode,
} from "../control/CommandTypes.js";
import { executeCommand } from "../executor/CommandExecutor.js";
import { DialogExecutor } from "../executor/DialogExecutor.js";
import { mapName } from "../game/PokemonCatalog.js";
import type {
  CommandAgentContext,
  CommandAgentGameState,
} from "./CommandAgentContext";

const TOOL_RESULT_CHAR_LIMIT = 2000;
const DETAILS_CHAR_LIMIT = 420;
const MAP_SNIPPET_CHAR_LIMIT = 700;
const TRANSCRIPT_PATTERN = /transcript=(\[.*\])/;
const HINT_CHAR_LIMIT = 300;

const directionSchema = z.enum(["up", "down", "left", "right"] satisfies [
  Direction,
  Direction,
  Direction,
  Direction,
]);

const navigateInputSchema = z.object({
  x: z.number().int().min(0).describe("Target map X coordinate."),
  y: z.number().int().min(0).describe("Target map Y coordinate."),
});

const interactInputSchema = z.object({
  direction: directionSchema
    .optional()
    .describe("Optional direction to face before pressing A."),
});

const waitInputSchema = z.object({
  frames: z
    .number()
    .int()
    .min(1)
    .max(600)
    .default(30)
    .describe("Frames to wait; 60 frames is about one second."),
});

const dialogActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("advance") }),
  z.strictObject({
    kind: z.literal("choose"),
    index: z
      .number()
      .int()
      .min(0)
      .describe("Zero-based menu choice index to select."),
  }),
  z.strictObject({
    kind: z.literal("input_name"),
    name: z
      .string()
      .min(1)
      .max(20)
      .describe("Name to submit on the naming screen."),
  }),
]) satisfies z.ZodType<DialogAction>;

const dialogInputSchema = z.object({
  action: dialogActionSchema.describe(
    "Dialog action to execute: advance, choose(index), or input_name(name)."
  ),
});

const battleActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("fight"),
    move: z.string().min(1).describe("Known move name to use."),
  }),
  z.strictObject({
    kind: z.literal("item"),
    item: z.string().min(1).describe("Bag item name to use."),
  }),
  z.strictObject({
    kind: z.literal("switch"),
    pokemon: z.string().min(1).describe("Party Pokemon nickname to switch to."),
  }),
  z.strictObject({ kind: z.literal("run") }),
]) satisfies z.ZodType<BattleAction>;

const battleInputSchema = z.object({
  action: battleActionSchema.describe(
    "Battle action to execute: fight(move), item(item), switch(pokemon), or run."
  ),
});

export interface PokemonCommandToolState {
  readonly facing: string;
  readonly mapId: number;
  readonly mapName: string;
  readonly mode: GameMode;
  readonly x: number;
  readonly y: number;
}

export interface PokemonCommandToolPokemonSnapshot {
  readonly hp: number;
  readonly level: number;
  readonly maxHp: number;
  readonly name: string;
  readonly species?: string;
  readonly status: string;
}

export interface PokemonCommandToolBattleSnapshot {
  readonly enemy?: PokemonCommandToolPokemonSnapshot;
  readonly inBattle: boolean;
  readonly party: readonly PokemonCommandToolPokemonSnapshot[];
  readonly type: string;
}

export interface PokemonCommandToolBattleContext {
  readonly after: PokemonCommandToolBattleSnapshot;
  readonly before: PokemonCommandToolBattleSnapshot;
}

export interface PokemonCommandToolResult {
  readonly after: PokemonCommandToolState;
  readonly battle?: PokemonCommandToolBattleContext;
  readonly before: PokemonCommandToolState;
  readonly command: Command;
  readonly hint?: string;
  readonly mapSnippet?: string;
  readonly ok: boolean;
  readonly result: CommandResult;
  readonly transcript?: readonly string[];
}

export function createCommandTools(context: CommandAgentContext): AgentTools {
  return {
    pokemon_navigate: createNavigateTool(context),
    pokemon_interact: createInteractTool(context),
    pokemon_wait: createWaitTool(context),
    pokemon_dialog: createDialogTool(context),
    pokemon_battle: createBattleTool(context),
  } satisfies AgentTools;
}

function createNavigateTool(context: CommandAgentContext): AgentTool {
  return {
    description:
      "Navigate to an overworld map coordinate using the command executor's pathfinding. Disabled outside overworld mode.",
    inputSchema: navigateInputSchema,
    execute: async ({ x, y }) =>
      runCommandTool(context, { type: "navigate", x, y }),
  } satisfies AgentTool;
}

function createInteractTool(context: CommandAgentContext): AgentTool {
  return {
    description:
      "Interact with the faced tile/NPC/sign via the command executor. Optionally face a direction first. Disabled outside overworld mode.",
    inputSchema: interactInputSchema,
    execute: async ({ direction }) =>
      runCommandTool(
        context,
        direction === undefined
          ? { type: "interact" }
          : { type: "interact", direction }
      ),
  } satisfies AgentTool;
}

function createWaitTool(context: CommandAgentContext): AgentTool {
  return {
    description:
      "Wait for a fixed number of frames, then refresh game state. Disabled during dialog; dialog is advanced automatically between turns unless a choice appears.",
    inputSchema: waitInputSchema,
    execute: async ({ frames }) =>
      runCommandTool(context, { type: "wait", frames }, { allowAnyMode: true }),
  } satisfies AgentTool;
}

function createDialogTool(context: CommandAgentContext): AgentTool {
  return {
    description:
      "Advance dialog, choose a menu option, or submit a name through the command executor. Available only in dialog mode.",
    inputSchema: dialogInputSchema,
    execute: async ({ action }) =>
      runCommandTool(context, { type: "dialog", action }),
  } satisfies AgentTool;
}

function createBattleTool(context: CommandAgentContext): AgentTool {
  return {
    description:
      "Use a battle command through the command executor: fight(move), item(item), switch(pokemon), or run. Available only in battle mode.",
    inputSchema: battleInputSchema,
    execute: async ({ action }) =>
      runCommandTool(context, { type: "battle", action }),
  } satisfies AgentTool;
}

async function runCommandTool(
  context: CommandAgentContext,
  command: Command,
  options: { readonly allowAnyMode?: boolean } = {}
): Promise<PokemonCommandToolResult> {
  const beforeState = await refreshState(context);
  if (command.type === "wait" && beforeState.mode === "dialog") {
    const result: CommandResult = {
      status: "rejected",
      reason: "dialog_wait_disabled",
      details:
        "Dialog advances automatically between turns; choose only when a prompt offers options.",
    };
    return capToolResult({
      ok: false,
      command,
      result,
      before: summarizeState(beforeState),
      after: summarizeState(beforeState),
      ...buildOptionalContext(context, beforeState, result),
    });
  }

  const executionMode =
    options.allowAnyMode === true && command.type === "wait"
      ? "overworld"
      : beforeState.mode;
  const result = await executeCommand(command, {
    ...context.executionContext,
    mode: executionMode,
  });

  const postCommand = await handlePostCommand(context, command, result);
  const afterState = postCommand.finalState;

  return capToolResult({
    ok: result.status === "success" || result.status === "partial" || result.status === "interrupted",
    command,
    result: capCommandResult(postCommand.result),
    before: summarizeState(beforeState),
    after: summarizeState(afterState),
    ...(afterState.mode === "battle" || command.type === "battle"
      ? { battle: buildBattleContext(beforeState, afterState) }
      : {}),
    ...(postCommand.transcript.length > 0
      ? { transcript: postCommand.transcript }
      : {}),
    ...buildOptionalContext(context, afterState, postCommand.result),
  });
}

interface PostCommandResult {
  readonly result: CommandResult;
  readonly transcript: string[];
  readonly finalState: CommandAgentGameState;
}

async function handlePostCommand(
  context: CommandAgentContext,
  command: Command,
  originalResult: CommandResult
): Promise<PostCommandResult> {
  const transcript: string[] = [];
  let state = await refreshState(context);
  let result = { ...originalResult };

  if (state.mode === "dialog" && command.type !== "dialog") {
    const dialogExecutor = new DialogExecutor(
      context.executionContext.controller,
      context.executionContext.dialogStateReader
    );
    const dialogResult = await dialogExecutor.execute({ type: "dialog", action: { kind: "advance" } });
    const pages = parseTranscript(dialogResult.details);
    transcript.push(...pages);

    if (dialogResult.reason === "choice_appeared") {
      result = {
        ...result,
        status: "interrupted",
        reason: "choice_appeared",
        details: combineDetails(result.details, dialogResult.details),
      };
    } else if (dialogResult.reason === "battle_started") {
      result = {
        ...result,
        status: "interrupted",
        reason: "battle_started",
        details: combineDetails(result.details, dialogResult.details),
      };
    } else {
      result = {
        ...result,
        details: combineDetails(result.details, dialogResult.details),
      };
    }

    state = await refreshState(context);
  }

  if (state.mode === "battle" && command.type === "battle") {
    const dialogExecutor = new DialogExecutor(
      context.executionContext.controller,
      context.executionContext.dialogStateReader
    );
    const battleDialog = await dialogExecutor.execute({ type: "dialog", action: { kind: "advance" } });
    const pages = parseTranscript(battleDialog.details);
    transcript.push(...pages);

    state = await refreshState(context);
    if (!state.fullState.battle.inBattle) {
      result = { status: "success", reason: "battle_ended", details: combineDetails(result.details, battleDialog.details) };
    }
  }

  return { result, transcript, finalState: state };
}

function parseTranscript(details: string | undefined): string[] {
  if (details === undefined) {
    return [];
  }
  const match = details.match(TRANSCRIPT_PATTERN);
  if (match === null) {
    return [];
  }
  try {
    return JSON.parse(match[1]) as string[];
  } catch {
    return [];
  }
}

function combineDetails(original: string | undefined, additional: string | undefined): string {
  if (original === undefined) {
    return additional ?? "";
  }
  if (additional === undefined || additional.length === 0) {
    return original;
  }
  return `${original}; ${additional}`;
}

async function refreshState(
  context: CommandAgentContext
): Promise<CommandAgentGameState> {
  const state = await context.readGameState();
  context.executionContext.mode = state.mode;
  context.executionContext.fullState = state.fullState;
  context.executionContext.mapWidth = state.mapWidth;
  context.executionContext.mapHeight = state.mapHeight;
  await context.updateMapMemory();
  context.mapMemoryStore.onUpdate(context.mapMemory);
  context.updateMapGraph();
  return state;
}

function summarizeState(state: CommandAgentGameState): PokemonCommandToolState {
  return {
    mode: state.mode,
    mapId: state.mapId,
    mapName: mapName(state.mapId),
    x: state.playerX,
    y: state.playerY,
    facing: state.facing,
  };
}

function buildOptionalContext(
  context: CommandAgentContext,
  state: CommandAgentGameState,
  result: CommandResult
): Pick<PokemonCommandToolResult, "hint" | "mapSnippet"> {
  const hint = buildHint(state, result);
  if (state.mode !== "overworld") {
    return hint === undefined ? {} : { hint };
  }

  const micro = context.mapMemory.renderMicro(
    state.mapId,
    state.playerY,
    state.playerX,
    state.facing
  );
  const mapSnippet = truncate(micro, MAP_SNIPPET_CHAR_LIMIT);
  return hint === undefined ? { mapSnippet } : { hint, mapSnippet };
}

function buildBattleContext(
  beforeState: CommandAgentGameState,
  afterState: CommandAgentGameState
): PokemonCommandToolBattleContext {
  return {
    before: summarizeBattle(beforeState),
    after: summarizeBattle(afterState),
  };
}

function summarizeBattle(
  state: CommandAgentGameState
): PokemonCommandToolBattleSnapshot {
  const battle = state.fullState.battle;
  return {
    type: battle.type,
    inBattle: battle.inBattle,
    enemy:
      battle.enemy === undefined
        ? undefined
        : summarizePokemon({
            name: battle.enemy.species,
            species: battle.enemy.species,
            level: battle.enemy.level,
            hp: battle.enemy.hp,
            maxHp: battle.enemy.maxHp,
            status: battle.enemy.status,
          }),
    party: state.fullState.party.members.map((pokemon) =>
      summarizePokemon({
        name: pokemon.nickname || pokemon.species,
        species: pokemon.species,
        level: pokemon.level,
        hp: pokemon.hp,
        maxHp: pokemon.maxHp,
        status: pokemon.status,
      })
    ),
  };
}

function summarizePokemon(
  pokemon: PokemonCommandToolPokemonSnapshot
): PokemonCommandToolPokemonSnapshot {
  return pokemon.species === undefined || pokemon.species === pokemon.name
    ? {
        name: pokemon.name,
        level: pokemon.level,
        hp: pokemon.hp,
        maxHp: pokemon.maxHp,
        status: pokemon.status,
      }
    : pokemon;
}

function buildHint(
  state: CommandAgentGameState,
  result: CommandResult
): string | undefined {
  if (result.status === "success") {
    return;
  }
  if (state.mode !== "overworld") {
    return state.mode === "dialog"
      ? "Current mode is dialog; dialog advances automatically between turns. Use pokemon_dialog only for visible choices or naming prompts."
      : `Current mode is ${state.mode}; use the mode-specific tool until overworld controls are available.`;
  }
  return "Check the map snippet, adjacent tiles, and target coordinate before retrying.";
}

function capCommandResult(result: CommandResult): CommandResult {
  return result.details === undefined
    ? result
    : { ...result, details: truncate(result.details, DETAILS_CHAR_LIMIT) };
}

function capToolResult(
  result: PokemonCommandToolResult
): PokemonCommandToolResult {
  let capped = result;
  if (serializedLength(capped) <= TOOL_RESULT_CHAR_LIMIT) {
    return capped;
  }

  capped = {
    ...capped,
    mapSnippet:
      capped.mapSnippet === undefined
        ? undefined
        : truncate(capped.mapSnippet, 300),
  };
  if (serializedLength(capped) <= TOOL_RESULT_CHAR_LIMIT) {
    return removeUndefined(capped);
  }

  capped = {
    ...capped,
    hint:
      capped.hint === undefined
        ? undefined
        : truncate(capped.hint, HINT_CHAR_LIMIT),
    result: capCommandResult({
      ...capped.result,
      details:
        capped.result.details === undefined
          ? undefined
          : truncate(capped.result.details, 180),
    }),
  };
  if (serializedLength(capped) <= TOOL_RESULT_CHAR_LIMIT) {
    return removeUndefined(capped);
  }

  return removeUndefined({
    ...capped,
    mapSnippet: undefined,
    hint:
      capped.hint ?? "Output trimmed to stay within the 2K tool payload limit.",
  });
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function serializedLength(value: PokemonCommandToolResult): number {
  return JSON.stringify(value).length;
}

function removeUndefined(
  result: PokemonCommandToolResult
): PokemonCommandToolResult {
  return JSON.parse(JSON.stringify(result)) as PokemonCommandToolResult;
}

export { TOOL_RESULT_CHAR_LIMIT as POKEMON_COMMAND_TOOL_RESULT_CHAR_LIMIT };
