import type { GameMode as CommandGameMode } from "../control/CommandTypes.js";
import { GameSession } from "../session/game-session.js";
import {
  createMiniState,
  MiniStateReader,
} from "../session/mini-state-reader.js";
import type {
  MiniState,
  GameMode as SessionGameMode,
  SessionState,
} from "../session/types.js";
import type {
  CommandAgentContext,
  CommandAgentGameState,
} from "./CommandAgentContext.js";

export async function syncCommandAgentContext(
  context: CommandAgentContext
): Promise<CommandAgentGameState> {
  let fallbackState: CommandAgentGameState | undefined;
  const session = new GameSession<CommandAgentGameState>({
    miniStateReader: {
      async read() {
        if (isMiniStateRamClient(context.client)) {
          return new MiniStateReader(context.client).read();
        }
        fallbackState = await context.readGameState();
        return createMiniStateFromCommandState(fallbackState);
      },
    },
    fullStateReader: {
      async read(sessionState: SessionState) {
        const rawState = fallbackState ?? (await context.readGameState());
        fallbackState = undefined;
        const sessionMode = toCommandGameMode(sessionState.mode);
        return {
          evidenceMode: readLastWorldMode(context),
          value: { ...rawState, mode: sessionMode },
        };
      },
    },
    onSync: async ({ fullState }) => {
      context.executionContext.mode = fullState.mode;
      context.executionContext.fullState = fullState.fullState;
      context.executionContext.mapWidth = fullState.mapWidth;
      context.executionContext.mapHeight = fullState.mapHeight;
      await context.updateMapMemory();
      context.mapMemoryStore.onUpdate(context.mapMemory);
      context.updateMapGraph();
    },
  });

  const result = await session.syncFullState();
  return result.fullState;
}

function readLastWorldMode(
  context: CommandAgentContext
): SessionGameMode | undefined {
  return typeof context.getLastWorld === "function"
    ? context.getLastWorld()?.mode
    : undefined;
}

function isMiniStateRamClient(
  client: CommandAgentContext["client"] | undefined
): client is CommandAgentContext["client"] {
  return (
    client !== undefined &&
    typeof client.read8 === "function" &&
    typeof client.readRange === "function"
  );
}

function createMiniStateFromCommandState(
  state: CommandAgentGameState
): MiniState {
  const mode = toSessionGameMode(state.mode);
  const miniState = createMiniState({
    battle: mode === "battle" ? 1 : 0,
    joyIgnore: 0,
    letterDelay: 0,
    mapId: state.mapId,
    namingScreenType: 0,
    partyCount: 1,
    screenText: "",
    textBoxId: 0,
    walkCounter: 0,
    windowY: mode === "dialog" ? 120 : 144,
    x: state.playerX,
    y: state.playerY,
  });
  return { ...miniState, mode };
}

function toSessionGameMode(mode: CommandGameMode): SessionGameMode {
  switch (mode) {
    case "battle":
      return "battle";
    case "dialog":
      return "dialog";
    case "overworld":
      return "overworld";
    default:
      return assertNever(mode);
  }
}

function toCommandGameMode(mode: SessionGameMode): CommandGameMode {
  switch (mode) {
    case "battle":
      return "battle";
    case "dialog":
    case "naming":
      return "dialog";
    case "menu":
    case "overworld":
    case "title":
      return "overworld";
    default:
      return assertNever(mode);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled session mode: ${value}`);
}
