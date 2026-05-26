import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from "react";
import type {
  AgentMemoryResponse,
  ConsoleEntry,
  GameStateResponse,
  MapMemoryResponse,
  RunSummary,
  TurnsResponse,
  ViewerState,
  ViewerTab,
} from "../api/types";

const MAX_CONSOLE_LINES = 500;
const MAX_TURNS = 50;

type ViewerAction =
  | { type: "set:summary"; payload: RunSummary }
  | { type: "set:gameState"; payload: GameStateResponse }
  | { type: "set:turns"; payload: TurnsResponse }
  | { type: "set:memory"; payload: AgentMemoryResponse }
  | { type: "set:mapMemory"; payload: MapMemoryResponse }
  | { type: "set:console"; payload: ConsoleEntry }
  | { type: "set:connection"; payload: Partial<ViewerState["connection"]> }
  | { type: "set:tab"; payload: ViewerTab }
  | { type: "set:selectedTurn"; payload: string | undefined }
  | { type: "snapshot"; payload: Partial<ViewerState> };

const initialState: ViewerState = {
  connection: { status: "connecting", lastSeq: 0 },
  summary: null,
  gameState: null,
  turns: null,
  memory: null,
  mapMemory: null,
  console: [],
  activeTab: "turns",
};

function reducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case "set:summary":
      return { ...state, summary: action.payload };
    case "set:gameState":
      return { ...state, gameState: action.payload };
    case "set:turns": {
      const turns = action.payload;
      if (turns.turns.length > MAX_TURNS) {
        turns.turns = turns.turns.slice(0, MAX_TURNS);
      }
      return { ...state, turns };
    }
    case "set:memory":
      return { ...state, memory: action.payload };
    case "set:mapMemory":
      return { ...state, mapMemory: action.payload };
    case "set:console": {
      const next = [...state.console, action.payload];
      return { ...state, console: next.length > MAX_CONSOLE_LINES ? next.slice(-MAX_CONSOLE_LINES) : next };
    }
    case "set:connection":
      return { ...state, connection: { ...state.connection, ...action.payload } };
    case "set:tab":
      return { ...state, activeTab: action.payload };
    case "set:selectedTurn":
      return { ...state, selectedTurnFile: action.payload };
    case "snapshot":
      return {
        ...state,
        ...(action.payload.summary !== undefined && { summary: action.payload.summary }),
        ...(action.payload.gameState !== undefined && { gameState: action.payload.gameState }),
        ...(action.payload.turns !== undefined && { turns: action.payload.turns }),
        ...(action.payload.memory !== undefined && { memory: action.payload.memory }),
        ...(action.payload.mapMemory !== undefined && { mapMemory: action.payload.mapMemory }),
      };
    default:
      return state;
  }
}

const StateCtx = createContext<ViewerState>(initialState);
const DispatchCtx = createContext<Dispatch<ViewerAction>>(() => undefined);

export function useViewerState() {
  return useContext(StateCtx);
}

export function useViewerDispatch() {
  return useContext(DispatchCtx);
}

const POLL_ENDPOINTS: Array<{ url: string; type: ViewerAction["type"] }> = [
  { url: "/api/global/run-summary", type: "set:summary" },
  { url: "/api/game-state?limit=8", type: "set:gameState" },
  { url: "/api/turns?limit=20", type: "set:turns" },
  { url: "/api/global/agent-memory", type: "set:memory" },
  { url: "/api/global/map-memory", type: "set:mapMemory" },
];

function useRestPolling(dispatch: Dispatch<ViewerAction>, interval = 1500) {
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      const results = await Promise.allSettled(
        POLL_ENDPOINTS.map(async (endpoint) => {
          const response = await fetch(`${endpoint.url}${endpoint.url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
          if (!response.ok) {
            return;
          }
          const data = await response.json();
          if (!cancelled) {
            dispatch({ type: endpoint.type, payload: data } as ViewerAction);
          }
        })
      );

      const allFailed = results.every((r) => r.status === "rejected");
      if (!cancelled) {
        dispatch({
          type: "set:connection",
          payload: allFailed ? { status: "closed", error: "REST polling failed" } : { status: "open", error: undefined },
        });
        timer = window.setTimeout(tick, interval);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [dispatch, interval]);
}

export function ViewerStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useRestPolling(dispatch);

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}
