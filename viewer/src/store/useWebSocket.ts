import { useEffect, useRef, type Dispatch } from "react";
import type { ServerMessage, GameButton } from "../api/types";

type ViewerAction =
  | { type: "set:summary"; payload: unknown }
  | { type: "set:gameState"; payload: unknown }
  | { type: "set:turns"; payload: unknown }
  | { type: "set:memory"; payload: unknown }
  | { type: "set:mapMemory"; payload: unknown }
  | { type: "set:console"; payload: unknown }
  | { type: "set:connection"; payload: unknown }
  | { type: "snapshot"; payload: unknown };

const RECONNECT_MIN_MS = 250;
const RECONNECT_MAX_MS = 5000;

function useWebSocket(dispatch: Dispatch<ViewerAction>, enabled: boolean) {
  const wsRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    let reconnectMs = RECONNECT_MIN_MS;

    function connect() {
      if (cancelled) {
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      dispatch({ type: "set:connection", payload: { status: "connecting" } });

      ws.onopen = () => {
        reconnectMs = RECONNECT_MIN_MS;
        dispatch({ type: "set:connection", payload: { status: "open", error: null } });
        if (lastSeqRef.current > 0) {
          ws.send(JSON.stringify({ type: "resume", lastSeq: lastSeqRef.current }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage;
          if ("seq" in msg && typeof msg.seq === "number") {
            lastSeqRef.current = msg.seq;
          }
          handleServerMessage(msg, dispatch);
        } catch {
          return;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!cancelled) {
          dispatch({ type: "set:connection", payload: { status: "closed" } });
          setTimeout(connect, reconnectMs);
          reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [dispatch, enabled]);

  return wsRef;
}

function handleServerMessage(msg: ServerMessage, dispatch: Dispatch<ViewerAction>) {
  switch (msg.type) {
    case "summary:update":
      dispatch({ type: "set:summary", payload: msg.payload });
      break;
    case "game-state:update":
      dispatch({ type: "set:gameState", payload: msg.payload });
      break;
    case "turn:recorded":
      break;
    case "memory:update":
      dispatch({ type: "set:memory", payload: msg.payload });
      break;
    case "map:update":
      dispatch({ type: "set:mapMemory", payload: msg.payload });
      break;
    case "console:line":
      dispatch({ type: "set:console", payload: msg.payload });
      break;
    case "snapshot":
      dispatch({ type: "snapshot", payload: msg.payload });
      break;
    default:
      break;
  }
}

function sendButtonPress(ws: WebSocket | null, button: GameButton, frames = 5) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "input:press",
      id: `btn-${Date.now()}`,
      payload: { button, frames },
    }));
  }
}
