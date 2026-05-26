import { useViewerState, useViewerDispatch } from "./store/ViewerStore";
import type { ViewerTab } from "./api/types";
import GameScreen from "./components/GameScreen";
import Gamepad from "./components/Gamepad";
import StatusBar from "./components/StatusBar";
import MapPanel from "./components/MapPanel";
import TurnReplayPanel from "./components/TurnReplayPanel";
import BattlePanel from "./components/BattlePanel";
import MemoryPanel from "./components/MemoryPanel";
import ConsolePanel from "./components/ConsolePanel";
import SupervisorPanel from "./components/SupervisorPanel";

const TABS: Array<{ id: ViewerTab; label: string }> = [
  { id: "turns", label: "턴 로그" },
  { id: "map", label: "맵" },
  { id: "battle", label: "배틀" },
  { id: "memory", label: "메모리" },
  { id: "supervisor", label: "Supervisor" },
  { id: "console", label: "콘솔" },
];

export default function App() {
  const state = useViewerState();
  const dispatch = useViewerDispatch();
  const { activeTab, summary, gameState, connection } = state;

  let connClass = "bad";
  let connLabel = "오프라인";
  if (connection.status === "open") {
    connClass = "";
    connLabel = "LIVE";
  } else if (connection.status === "connecting") {
    connClass = "warn";
    connLabel = "연결 중";
  }

  return (
    <div className="v2-shell">
      <header className="v2-header">
        <article className="card" style={{ minHeight: "auto", padding: "6px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`chip ${connClass}`}>
            {connLabel}
          </span>
          <span className="value" style={{ marginTop: 0 }}>{summary?.runId ?? "대기 중"}</span>
        </article>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <span className="chip">{summary?.status ?? "..."}</span>
          <span className="chip">스텝 {summary?.totalSteps ?? 0}</span>
          <span className="chip">오류 {summary?.counts?.errors ?? 0}</span>
        </div>
      </header>

      <main className="v2-main">
        <div className="v2-left">
          <GameScreen gameState={gameState} runId={summary?.runId} />
          <Gamepad />
        </div>

        <article className="panel">
          <div className="llm-tabs">
            {TABS.map((t) => (
              <button
                type="button"
                className={`tab ${activeTab === t.id ? "active" : ""}`}
                key={t.id}
                onClick={() => dispatch({ type: "set:tab", payload: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="v2-tab-body">
            <div style={{ display: activeTab === "turns" ? "block" : "none" }}><TurnReplayPanel /></div>
            <div style={{ display: activeTab === "map" ? "block" : "none" }}><MapPanel payload={state.mapMemory} /></div>
            <div style={{ display: activeTab === "battle" ? "block" : "none" }}><BattlePanel gameState={gameState} /></div>
            <div style={{ display: activeTab === "memory" ? "block" : "none" }}><MemoryPanel payload={state.memory} /></div>
            <div style={{ display: activeTab === "supervisor" ? "block" : "none" }}><SupervisorPanel /></div>
            <div style={{ display: activeTab === "console" ? "block" : "none" }}><ConsolePanel entries={state.console} /></div>
          </div>
        </article>
      </main>

      <StatusBar />
    </div>
  );
}
