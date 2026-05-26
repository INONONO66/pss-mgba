import { useEffect, useState } from "react";
import { useAgentMemory, useGameState, useMapMemory, useRunSummary, useTurns } from "./api/hooks";
import GameScreen from "./components/GameScreen";
import GameState from "./components/GameState";
import LlmPanel from "./components/LlmPanel";
import MapPanel from "./components/MapPanel";
import MemoryPanel from "./components/MemoryPanel";
import TopBar from "./components/TopBar";
import TurnLog from "./components/TurnLog";

type BottomTab = "turns" | "memory" | "map";

const TAB_LABELS: Record<BottomTab, string> = { turns: "턴 로그", memory: "메모리", map: "맵" };
const TAB_TITLES: Record<BottomTab, string> = { turns: "통합 런 타임라인", memory: "에이전트 메모리", map: "글로벌 맵" };
const TAB_IDS: BottomTab[] = ["turns", "memory", "map"];

export default function App() {
  const summary = useRunSummary();
  const gameState = useGameState();
  const turns = useTurns();
  const memory = useAgentMemory();
  const mapMemory = useMapMemory();
  const [refreshedAt, setRefreshedAt] = useState(new Date());
  const [bottomTab, setBottomTab] = useState<BottomTab>("turns");

  useEffect(() => {
    const timer = window.setInterval(() => setRefreshedAt(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="shell">
      <TopBar summary={summary} gameState={gameState} refreshedAt={refreshedAt} />
      <section className="grid" aria-label="실시간 관측 대시보드">
        <GameScreen gameState={gameState} runId={summary?.runId} />
        <GameState payload={gameState} />
        <LlmPanel payload={turns} />
        <article className="panel context-panel">
          <div className="panel-header">
            <h2>{TAB_TITLES[bottomTab]}</h2>
            <p>턴 파일을 기준으로 런 흐름과 맵/메모리를 함께 봅니다</p>
          </div>
          <div className="context-tabs">
            {TAB_IDS.map((id) => (
              <button
                type="button"
                className={`tab ${bottomTab === id ? "active" : ""}`}
                key={id}
                onClick={() => setBottomTab(id)}
              >
                {TAB_LABELS[id]}
              </button>
            ))}
          </div>
          <div className="context-body scroll">
            {bottomTab === "turns" && <TurnLog payload={turns} />}
            {bottomTab === "memory" && <MemoryPanel payload={memory} />}
            {bottomTab === "map" && <MapPanel payload={mapMemory} />}
          </div>
        </article>
      </section>
    </main>
  );
}
