import { useEffect, useMemo, useState } from "react";
import type { TurnRecord, TurnTimelineEvent, TurnsResponse } from "../api/types";
import MapGrid from "./MapGrid";
import Timeline from "./Timeline";
import { actionLabel } from "./labels";
import { frameRange, formatDuration, gameActionLabel, runTurnStatus, timelinePayload, timelineSummary, timelineTitle, timelineTone, turnDurationMs, turnErrorCount } from "./turnTimeline";
import { isRecord, json, stateFields, value } from "./shared";

type TurnTab = "overview" | "timeline" | "tools" | "state" | "map" | "system" | "user" | "reasoning" | "raw";

const TABS: Array<[TurnTab, string]> = [
  ["overview", "판단"],
  ["timeline", "타임라인"],
  ["tools", "도구"],
  ["state", "상태"],
  ["map", "맵"],
  ["system", "시스템"],
  ["user", "유저"],
  ["reasoning", "추론"],
  ["raw", "JSON"],
];

function safeJson(input: unknown): string {
  return json(input).replace(new RegExp("pokemon" + "_[a-z_]+", "g"), (name) => actionLabel(name));
}

function publicPrompt(text: string | undefined, fallback: string): string {
  if (text === undefined || text.trim().length === 0) return fallback;
  return text
    .replace(/\[AVAILABLE TOOLS\][\s\S]*?(?=\n\[[A-Z ][A-Z ]+\]|$)/g, "[사용 가능한 행동]\n현재 모드에서 허용된 행동 목록입니다.")
    .replace(new RegExp("pokemon" + "_[a-z_]+", "g"), (name) => actionLabel(name));
}

function Overview({ turn }: { turn: TurnRecord }) {
  const errors = turnErrorCount(turn);
  return (
    <div className="state-block">
      <div className="kv-grid">
        <div className="kv"><b>턴 상태</b><span>{runTurnStatus(turn)}</span></div>
        <div className="kv"><b>게임 행동</b><span>{gameActionLabel(turn)}</span></div>
        <div className="kv"><b>프레임</b><span>{frameRange(turn)}</span></div>
        <div className="kv"><b>소요시간</b><span>{formatDuration(turnDurationMs(turn))}</span></div>
        <div className="kv"><b>이벤트</b><span>{value(turn.timeline?.length ?? 0)}개</span></div>
        <div className="kv"><b>오류</b><span>{errors > 0 ? `${errors}건` : "없음"}</span></div>
      </div>
      <Timeline steps={[
        { title: "관측", tone: "seeing", children: <pre className="mono-block">{publicPrompt(turn.userPrompt, "관측 프롬프트 없음")}</pre> },
        { title: "추론", tone: "thinking", children: <div className="reasoning-block">{turn.reasoning || "명시적 추론 없음"}</div> },
        { title: "결정", tone: "deciding", children: <DecisionSummary turn={turn} /> },
      ]} />
    </div>
  );
}

function DecisionSummary({ turn }: { turn: TurnRecord }) {
  const gameAction = turn.toolCalls?.find((call) => call.isGameAction) ?? turn.toolCalls?.[0];
  return (
    <>
      <span className="action-badge"><span className="btn">{actionLabel(gameAction?.toolName)}</span></span>
      <p className="muted">{gameAction?.isGameAction ? "게임 행동을 실행했습니다." : gameAction ? "보조 기록을 남겼습니다." : "기록된 행동이 없습니다."}</p>
      {turn.parsedCommand ? <pre className="mono-block">{safeJson(turn.parsedCommand)}</pre> : null}
    </>
  );
}

function TimelineView({ turn }: { turn: TurnRecord }) {
  const events = turn.timeline ?? [];
  if (events.length === 0) return <div className="empty">타임라인 이벤트가 없습니다.</div>;
  return (
    <Timeline steps={events.map((event) => ({
      title: timelineTitle(event),
      tone: timelineTone(event),
      children: <TimelineEvent event={event} />,
    }))} />
  );
}

function TimelineEvent({ event }: { event: TurnTimelineEvent }) {
  const payload = timelinePayload(event);
  return (
    <div className="state-block">
      <div className="status-line">
        <span className={`event-badge ${event.type === "turn-error" ? "error" : event.type.startsWith("tool") ? "decision" : "state"}`}>{event.type}</span>
        {event.timestamp ? <span className="chip">{event.timestamp}</span> : null}
        {event.toolCallId ? <span className="chip">{event.toolCallId}</span> : null}
        {event.isGameAction ? <span className="chip warn">게임 행동</span> : event.toolName ? <span className="chip">보조</span> : null}
      </div>
      <div className={event.type === "turn-error" ? "reasoning-block" : "mono-block"}>{timelineSummary(event)}</div>
      {payload !== undefined ? <details><summary>payload</summary><pre className="mono-block">{safeJson(payload)}</pre></details> : null}
    </div>
  );
}

function ToolsView({ turn }: { turn: TurnRecord }) {
  const calls = turn.toolCalls ?? [];
  if (calls.length === 0) return <div className="empty">도구 호출이 없습니다.</div>;
  return (
    <div className="event-list">
      {calls.map((call) => (
        <article className="event-item" key={call.toolCallId}>
          <div className="event-header">
            <span className="event-badge decision">{actionLabel(call.toolName)}</span>
            <span className="muted">{call.toolCallId}</span>
            {call.isGameAction ? <span className="chip warn">게임 행동</span> : <span className="chip">보조 기록</span>}
          </div>
          <div className="event-body">
            <div className="kv-mini"><b>input</b><span>{safeJson(call.input)}</span><b>output</b><span>{safeJson(call.output)}</span></div>
          </div>
        </article>
      ))}
    </div>
  );
}

function StateView({ turn }: { turn: TurnRecord }) {
  const before = stateSummary(turn.gameState?.before);
  const after = stateSummary(turn.gameState?.after);
  return (
    <div className="state-block">
      <div className="kv-grid">
        <div className="kv"><b>before</b><span>{before}</span></div>
        <div className="kv"><b>after</b><span>{after}</span></div>
      </div>
      <details open><summary>before JSON</summary><pre className="mono-block">{safeJson(turn.gameState?.before)}</pre></details>
      <details><summary>after JSON</summary><pre className="mono-block">{safeJson(turn.gameState?.after)}</pre></details>
    </div>
  );
}

function stateSummary(state: unknown): string {
  if (!isRecord(state)) return "?";
  const fields = stateFields({ state });
  return `${value(fields.mapName ?? fields.mapId)} · x${value(fields.x)} y${value(fields.y)} · ${value(fields.facing)} · badges ${value(fields.badgeCount)}`;
}

function MapView({ turn }: { turn: TurnRecord }) {
  return (
    <div className="state-block">
      <div className="map-section"><h3>턴 맵</h3><MapGrid ascii={turn.mapAscii ?? null} /></div>
      <details open><summary>map graph</summary><pre className="mono-block">{turn.mapGraph || "맵 그래프 없음"}</pre></details>
      <details><summary>map ascii</summary><pre className="mono-block">{turn.mapAscii || "맵 없음"}</pre></details>
    </div>
  );
}

export default function LlmPanel({ payload }: { payload: TurnsResponse | null }) {
  const [selectedFile, setSelectedFile] = useState<string | undefined>();
  const [tab, setTab] = useState<TurnTab>("overview");
  const turns = payload?.turns ?? [];
  useEffect(() => {
    const selectedStillExists = selectedFile !== undefined && turns.some((entry) => entry.fileName === selectedFile);
    if (turns.length > 0 && !selectedStillExists) setSelectedFile(turns[0].fileName);
  }, [turns, selectedFile]);
  const selected = useMemo(() => turns.find((entry) => entry.fileName === selectedFile) ?? turns[0], [turns, selectedFile]);
  return (
    <article className="panel llm-panel">
      <div className="panel-header"><h2>턴 통합 로그</h2><p>{payload ? `${payload.count} 저장됨 · 최신 ${turns[0]?.fileName ?? "없음"}` : "대기 중..."}</p></div>
      <div className="llm-layout">
        <div className="llm-rail">{turns.map((turn) => <button type="button" className={`history-button ${turn.fileName === selected?.fileName ? "active" : ""}`} key={turn.fileName ?? turn.turn} onClick={() => setSelectedFile(turn.fileName)}>{turn.fileName}{"\n"}턴 {value(turn.turn)} · 이벤트 {value(turn.timeline?.length ?? 0)} · {gameActionLabel(turn)}</button>)}</div>
        <div className="panel" style={{ border: 0, boxShadow: "none", background: "transparent" }}>
          <div className="llm-tabs">{TABS.map(([id, label]) => <button type="button" className={`tab ${tab === id ? "active" : ""}`} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
          <div className="llm-detail scroll">{selected ? <>
            {tab === "overview" ? <Overview turn={selected} /> : null}
            {tab === "timeline" ? <TimelineView turn={selected} /> : null}
            {tab === "tools" ? <ToolsView turn={selected} /> : null}
            {tab === "state" ? <StateView turn={selected} /> : null}
            {tab === "map" ? <MapView turn={selected} /> : null}
            {tab === "system" ? <pre className="pretty-text">{publicPrompt(selected.systemPrompt, "시스템 프롬프트 없음")}</pre> : null}
            {tab === "user" ? <pre className="pretty-text">{publicPrompt(selected.userPrompt, "유저 프롬프트 없음")}</pre> : null}
            {tab === "reasoning" ? <pre className="pretty-text">{selected.reasoning || "추론 없음"}</pre> : null}
            {tab === "raw" ? <pre className="pretty-text">{safeJson(selected)}</pre> : null}
          </> : <div className="empty">턴 기록이 없습니다.</div>}</div>
        </div>
      </div>
    </article>
  );
}
