import { useEffect, useState } from "react";
import type { AgentMemoryResponse, EventsResponse, GameStateResponse, MapMemoryResponse, RunSummary, TurnsResponse } from "./types";

export function usePolling<T>(url: string, interval = 1000): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}nonce=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const payload = (await response.json()) as T;
        if (!cancelled) { setData(payload); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) timer = window.setTimeout(tick, interval);
      }
    };

    void tick();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [url, interval]);

  return { data, error };
}

export function useTurns(limit = 20) { return usePolling<TurnsResponse>(`/api/turns?limit=${limit}`, 1000).data; }
export function useGameState(limit = 8) { return usePolling<GameStateResponse>(`/api/game-state?limit=${limit}`, 1000).data; }
export function useRunSummary() { return usePolling<RunSummary>("/api/run-summary", 1000).data; }
export function useEvents(limit = 80) { return usePolling<EventsResponse>(`/api/events?limit=${limit}`, 1000).data; }
export function useAgentMemory() { return usePolling<AgentMemoryResponse>("/api/global/agent-memory", 2000).data; }
export function useMapMemory() { return usePolling<MapMemoryResponse>("/api/global/map-memory", 2000).data; }
