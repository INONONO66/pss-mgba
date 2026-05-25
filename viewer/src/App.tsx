import { useEffect, useState } from "react";
import { useEvents, useGameState, useLlmConversations, useRunSummary } from "./api/hooks";
import EventLog from "./components/EventLog";
import GameScreen from "./components/GameScreen";
import GameState from "./components/GameState";
import LlmPanel from "./components/LlmPanel";
import TopBar from "./components/TopBar";

export default function App() {
  const summary = useRunSummary();
  const gameState = useGameState();
  const llm = useLlmConversations();
  const events = useEvents();
  const [refreshedAt, setRefreshedAt] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setRefreshedAt(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return <main className="shell"><TopBar summary={summary} gameState={gameState} refreshedAt={refreshedAt} /><section className="grid" aria-label="실시간 관측 대시보드"><GameScreen gameState={gameState} runId={summary?.runId} /><GameState payload={gameState} /><LlmPanel payload={llm} /><EventLog payload={events} /></section></main>;
}
