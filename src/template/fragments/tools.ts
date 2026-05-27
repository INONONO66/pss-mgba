import type { SessionState } from "../../session/types.js";

const COMMON_TOOL_NAMES = [
  "pokemon_memory_read",
  "pokemon_memory_write",
] as const;
const WAIT_TOOL_NAMES = ["pokemon_wait"] as const;
const OVERWORLD_TOOL_NAMES = [
  "pokemon_navigate",
  "pokemon_interact",
  "pokemon_save",
  "pokemon_load",
  "pokemon_load_rollback",
] as const;
const DIALOG_TOOL_NAMES = ["pokemon_dialog"] as const;
const BATTLE_TOOL_NAMES = ["pokemon_battle"] as const;

export type SessionToolName =
  | (typeof COMMON_TOOL_NAMES)[number]
  | (typeof WAIT_TOOL_NAMES)[number]
  | (typeof OVERWORLD_TOOL_NAMES)[number]
  | (typeof DIALOG_TOOL_NAMES)[number]
  | (typeof BATTLE_TOOL_NAMES)[number];

export type ToolResolutionState = Pick<SessionState, "mode">;

export function resolveTools(
  state: ToolResolutionState
): readonly SessionToolName[] {
  switch (state.mode) {
    case "battle":
      return [...COMMON_TOOL_NAMES, ...WAIT_TOOL_NAMES, ...BATTLE_TOOL_NAMES];
    case "dialog":
    case "naming":
      return [...COMMON_TOOL_NAMES, ...DIALOG_TOOL_NAMES];
    case "menu":
    case "overworld":
    case "title":
      return [
        ...COMMON_TOOL_NAMES,
        ...WAIT_TOOL_NAMES,
        ...OVERWORLD_TOOL_NAMES,
      ];
    default:
      return assertNever(state.mode);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled session mode: ${String(value)}`);
}

export function selectToolsForSessionState<TTool>(
  state: ToolResolutionState,
  tools: Readonly<Record<string, TTool>>
): Record<string, TTool> {
  return Object.fromEntries(
    resolveTools(state).flatMap((name) => {
      const tool = tools[name];
      return tool === undefined ? [] : [[name, tool]];
    })
  );
}

export function renderToolList(toolNames: readonly string[]): string[] {
  return toolNames.length === 0
    ? ["- none"]
    : [...toolNames].sort().map((name) => `- ${name}`);
}
