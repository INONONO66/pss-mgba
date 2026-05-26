import { useEffect, useMemo, useState } from "react";
import type { TurnRecord, TurnsResponse } from "../api/types";
import MapGraphView from "./MapGraphView";
import MapGrid from "./MapGrid";
import { visualGraphFromText } from "./mapVisuals";
import { json, value } from "./shared";
import Timeline from "./Timeline";
import TurnTimelineView from "./TurnTimelineView";
import { detectorStatus, eventsForTurn, formatDuration, frameRange, gameActionLabel, runTurnStatus, sortedTurns, turnDurationMs } from "./turnTimeline";

type TurnTab = "overview" | "timeline" | "system" | "user" | "reasoning" | "map" | "raw";

function Overview({ turn }: { turn: TurnRecord }) {
  const gameAction = turn.toolCalls?.find((call) => call.isGameAction) ?? turn.toolCalls?.[0];
  return (
    <div className="llm-overview">
      <section className="decision-card">
        <div className="decision-head">
          <div className="decision-head-group">
            <span className="action-badge"><span className="btn">{gameActionLabel(turn)}</span>{runTurnStatus(turn)}</span>
            <span className="muted">턴 {turn.turn} · {value(turn.fileName)}</span>
          </div>
          <span className="muted">{formatDuration(turnDurationMs(turn))}</span>
        </div>
        <div className="kv-grid">
          <div className="kv"><b>프레임</b><span>{frameRange(turn)}</span></div>
          <div className="kv"><b>감지기</b><span>{detectorStatus(turn)}</span></div>
          <div className="kv"><b>도구 호출</b><span>{turn.toolCalls?.length ?? 0}</span></div>
          <div className="kv"><b>응답</b><span>{turn.response ? `${turn.response.length} chars` : "없음"}</span></div>
        </div>
      </section>

      <Timeline steps={[
        { title: "관측", tone: "seeing", children: <pre className="mono-block overview-prompt">{turn.userPrompt ?? "유저 프롬프트 없음"}</pre> },
        { title: "추론", tone: "thinking", children: <div className={`reasoning-block ${turn.reasoning ? "" : "muted"}`}>{turn.reasoning || "명시적 추론 없음"}</div> },
        { title: "결정", tone: "deciding", children: <pre className="mono-block">{json(gameAction ?? turn.parsedCommand ?? {})}</pre> },
      ]} />
    </div>
  );
}

export default function LlmPanel({ payload }: { payload: TurnsResponse | null }) {
  const [selectedFile, setSelectedFile] = useState<string | undefined>();
  const [tab, setTab] = useState<TurnTab>("overview");
  const turns = useMemo(() => sortedTurns(payload), [payload]);
  useEffect(() => {
    const selectedStillExists = selectedFile !== undefined && turns.some((entry) => entry.fileName === selectedFile);
    if (turns.length > 0 && !selectedStillExists) {
      setSelectedFile(turns[0].fileName);
    }
  }, [turns, selectedFile]);
  const selected = useMemo(() => turns.find((entry) => entry.fileName === selectedFile) ?? turns[0], [turns, selectedFile]);
  return (
    <article className="panel llm-panel">
      <div className="panel-header"><h2>턴 통합 로그</h2><p>{payload ? `${payload.count} 저장됨 · 최신 ${turns[0]?.fileName ?? "없음"}` : "대기 중..."}</p></div>
      <div className="llm-layout">
        <div className="llm-rail">
          {turns.map((turn) => (
            <button type="button" className={`history-button ${turn.fileName === selected?.fileName ? "active" : ""}`} key={turn.fileName ?? turn.turn} onClick={() => setSelectedFile(turn.fileName)}>
              {turn.fileName}{"\n"}턴 {value(turn.turn)} · {gameActionLabel(turn)} · {runTurnStatus(turn)}
            </button>
          ))}
        </div>
        <div className="panel" style={{ border: 0, boxShadow: "none", background: "transparent" }}>
          <div className="llm-tabs">{[["overview", "판단"], ["timeline", "타임라인"], ["system", "시스템"], ["user", "유저"], ["reasoning", "추론"], ["map", "맵"], ["raw", "원본"]].map(([id, label]) => <button type="button" className={`tab ${tab === id ? "active" : ""}`} key={id} onClick={() => setTab(id as TurnTab)}>{label}</button>)}</div>
          <div className="llm-detail scroll">
            {selected ? <TurnDetail turn={selected} tab={tab} /> : <div className="empty">턴 기록이 없습니다.</div>}
          </div>
        </div>
      </div>
    </article>
  );
}

function TurnDetail({ tab, turn }: { tab: TurnTab; turn: TurnRecord }) {
  if (tab === "overview") return <Overview turn={turn} />;
  if (tab === "timeline") return <TurnTimelineView events={eventsForTurn(turn)} />;
  if (tab === "system") return <pre className="pretty-text">{turn.systemPrompt ?? "시스템 프롬프트 없음"}</pre>;
  if (tab === "user") return <pre className="pretty-text">{turn.userPrompt ?? "유저 프롬프트 없음"}</pre>;
  if (tab === "reasoning") return <pre className="pretty-text">{turn.reasoning || "추론 없음"}</pre>;
  if (tab === "map") {
    return (
      <div className="turn-map-layout">
        {turn.mapAscii ? <div><h3 className="prompt-section-title">턴 맵</h3><MapGrid ascii={turn.mapAscii} /></div> : <div className="empty compact">턴 맵 없음</div>}
        {turn.mapGraph ? <MapGraphView graph={visualGraphFromText(turn.mapGraph)} title="턴 맵 그래프" /> : <div className="empty compact">턴 맵 그래프 없음</div>}
      </div>
    );
  }
  return <pre className="pretty-text">{json(turn)}</pre>;
}
