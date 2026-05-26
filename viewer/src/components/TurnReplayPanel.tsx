import { useMemo } from "react";
import type { TurnRecord } from "../api/types";
import { useViewerState, useViewerDispatch } from "../store/ViewerStore";
import { parsePromptSections } from "../lib/sections";
import { extractReasoning, extractSystemChips } from "../lib/reasoning";
import { actionLabel } from "./labels";
import MapGrid from "./MapGrid";
import MapGraphView from "./MapGraphView";
import { visualGraphFromText } from "./mapVisuals";
import { json, value } from "./shared";
import Timeline from "./Timeline";
import TurnTimelineView from "./TurnTimelineView";
import {
  detectorStatus,
  eventsForTurn,
  formatDuration,
  frameRange,
  gameActionLabel,
  runTurnStatus,
  sortedTurns,
  turnDurationMs,
} from "./turnTimeline";

function ObservationStep({ turn }: { turn: TurnRecord }) {
  const sections = useMemo(() => parsePromptSections(turn.userPrompt ?? ""), [turn.userPrompt]);
  const chips = useMemo(() => extractSystemChips(turn), [turn]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {chips.chips.map((c) => (
          <span key={c.label} className={`chip ${c.type === "hint" ? "warn" : ""}`}>{c.label}</span>
        ))}
      </div>
      {sections.map((section) => (
        <details key={section.title}>
          <summary className="label" style={{ cursor: "pointer", padding: "4px 0" }}>{section.label}</summary>
          <pre className="mono-block" style={{ maxHeight: 200, overflow: "auto" }}>{section.content}</pre>
        </details>
      ))}
    </div>
  );
}

function ReasoningStep({ turn }: { turn: TurnRecord }) {
  const result = useMemo(() => extractReasoning(turn), [turn]);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {result.source !== "none" ? (
        <span className="chip">{result.source}</span>
      ) : null}
      <div className={`reasoning-block ${result.thinking ? "" : "muted"}`} style={{ maxHeight: 200, overflow: "auto" }}>
        {result.thinking ?? "명시적 추론 없음"}
      </div>
    </div>
  );
}

function DecisionStep({ turn }: { turn: TurnRecord }) {
  const gameAction = turn.toolCalls?.find((c) => c.isGameAction) ?? turn.toolCalls?.[0];
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="decision-card">
        <div className="decision-head">
          <span className="action-badge">
            <span className="btn">{gameActionLabel(turn)}</span>
            {runTurnStatus(turn)}
          </span>
          <span className="muted" style={{ font: "500 10px/1 var(--mono)" }}>{formatDuration(turnDurationMs(turn))}</span>
        </div>
        <div className="kv-grid">
          <div className="kv"><b>프레임</b><span>{frameRange(turn)}</span></div>
          <div className="kv"><b>감지기</b><span>{detectorStatus(turn)}</span></div>
          <div className="kv"><b>도구 호출</b><span>{turn.toolCalls?.length ?? 0}</span></div>
          <div className="kv"><b>응답 길이</b><span>{turn.response ? `${turn.response.length} chars` : "없음"}</span></div>
        </div>
      </div>
      {gameAction ? (
        <div>
          <span className="label">게임 액션</span>
          <pre className="mono-block" style={{ maxHeight: 150, overflow: "auto", marginTop: 4 }}>{json(gameAction)}</pre>
        </div>
      ) : null}
      {turn.rationale ? <div className="rationale-block">{turn.rationale}</div> : null}
    </div>
  );
}

function ResultStep({ turn }: { turn: TurnRecord }) {
  const events = useMemo(() => eventsForTurn(turn), [turn]);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <TurnTimelineView events={events} />
      {turn.toolCalls && turn.toolCalls.length > 0 ? (
        <div style={{ display: "grid", gap: 8 }}>
          <span className="label">도구 호출 상세</span>
          {turn.toolCalls.map((call) => (
            <details key={call.toolCallId} style={{ background: "var(--panel-soft)", border: "1px solid rgba(196,255,166,.12)", borderRadius: 4 }}>
              <summary style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer" }}>
                <span className="event-badge decision">{actionLabel(call.toolName)}</span>
                <span className="muted" style={{ font: "10px/1 var(--mono)" }}>{call.toolName}</span>
                {call.isGameAction ? <span className="chip">game</span> : null}
              </summary>
              <div className="tool-call-payloads">
                <pre className="mono-block">{json({ input: call.input })}</pre>
                <pre className="mono-block">{json({ output: call.output })}</pre>
              </div>
            </details>
          ))}
        </div>
      ) : null}
      {turn.mapAscii || turn.mapGraph ? (
        <div style={{ display: "grid", gap: 8 }}>
          {turn.mapAscii ? (
            <div>
              <span className="label">턴 맵</span>
              <MapGrid ascii={turn.mapAscii} />
            </div>
          ) : null}
          {turn.mapGraph ? (
            <MapGraphView graph={visualGraphFromText(turn.mapGraph)} title="턴 맵 그래프" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TurnDetail({ turn }: { turn: TurnRecord }) {
  return (
    <div className="p-4">
      <Timeline steps={[
        { title: "관측 (LLM 입력)", tone: "seeing" as const, children: <ObservationStep turn={turn} /> },
        { title: "추론 (Thinking)", tone: "thinking" as const, children: <ReasoningStep turn={turn} /> },
        { title: "결정 (Action)", tone: "deciding" as const, children: <DecisionStep turn={turn} /> },
        { title: "결과 (Result)", tone: "state" as const, children: <ResultStep turn={turn} /> },
      ]} />
    </div>
  );
}

export default function TurnReplayPanel() {
  const { turns, selectedTurnFile } = useViewerState();
  const dispatch = useViewerDispatch();
  const sorted = useMemo(() => sortedTurns(turns), [turns]);

  const selected = useMemo(() => {
    if (selectedTurnFile) {
      const found = sorted.find((t) => t.fileName === selectedTurnFile);
      if (found) {
        return found;
      }
    }
    return sorted[0];
  }, [sorted, selectedTurnFile]);

  if (sorted.length === 0) {
    return <div className="empty">턴 기록이 없습니다.</div>;
  }

  return (
    <div className="v2-replay">
      <div className="v2-replay-rail">
        {sorted.map((turn) => (
          <button
            type="button"
            key={turn.fileName ?? turn.turn}
            className={`v2-replay-btn ${turn.fileName === selected?.fileName ? "active" : ""}`}
            onClick={() => dispatch({ type: "set:selectedTurn", payload: turn.fileName })}
          >
            <div className="turn-label">턴 {value(turn.turn)}</div>
            <div className="turn-meta">{gameActionLabel(turn)} · {runTurnStatus(turn)}</div>
          </button>
        ))}
      </div>
      <div className="scroll">
        {selected ? <TurnDetail turn={selected} /> : <div className="empty">턴을 선택하세요</div>}
      </div>
    </div>
  );
}
