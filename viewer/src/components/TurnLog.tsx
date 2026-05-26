import type { ToolCallRecord, TurnRecord, TurnsResponse } from "../api/types";
import { actionLabel } from "./labels";
import MapGraphView from "./MapGraphView";
import MapGrid from "./MapGrid";
import { visualGraphFromText } from "./mapVisuals";
import { json, value } from "./shared";
import TurnTimelineView from "./TurnTimelineView";
import { detectorStatus, eventsForTurn, formatDuration, frameRange, gameActionLabel, runTurnStatus, sortedTurns, turnDurationMs, turnErrorCount } from "./turnTimeline";

export default function TurnLog({ payload }: { payload: TurnsResponse | null }) {
  const turns = sortedTurns(payload);
  if (turns.length === 0) { return <div className="empty">턴 기록이 없습니다.</div>; }
  return (
    <div className="turn-log-list">
      {turns.map((turn) => (
        <article className="turn-card" key={turn.fileName ?? turn.turn}>
          <header className="turn-card-header">
            <div>
              <h3>턴 {turn.turn}</h3>
              <p>{value(turn.fileName)} · {value(turn.finishedAt ?? turn.startedAt)}</p>
            </div>
            <span className="action-badge"><span className="btn">{gameActionLabel(turn)}</span>{runTurnStatus(turn)}</span>
          </header>

          <section className="turn-stat-grid">
            <div className="kv"><b>프레임</b><span>{frameRange(turn)}</span></div>
            <div className="kv"><b>시간</b><span>{formatDuration(turnDurationMs(turn))}</span></div>
            <div className="kv"><b>도구</b><span>{turn.toolCalls?.length ?? 0}</span></div>
            <div className="kv"><b>오류</b><span>{turnErrorCount(turn)}</span></div>
            <div className="kv"><b>감지기</b><span>{detectorStatus(turn)}</span></div>
            <div className="kv"><b>명령</b><span>{commandSummary(turn)}</span></div>
          </section>

          {turn.rationale ? <div className="rationale-block">{turn.rationale}</div> : null}

          <section className="turn-section">
            <h4>런 타임라인</h4>
            <TurnTimelineView events={eventsForTurn(turn)} />
          </section>

          {(turn.toolCalls?.length ?? 0) > 0 ? (
            <section className="turn-section">
              <h4>도구 호출</h4>
              <div className="tool-call-list">{turn.toolCalls?.map((call) => <ToolCallRow call={call} key={call.toolCallId} />)}</div>
            </section>
          ) : null}

          {turn.mapAscii || turn.mapGraph ? (
            <section className="turn-section turn-map-layout">
              {turn.mapAscii ? <div><h4>턴 맵</h4><MapGrid ascii={turn.mapAscii} /></div> : null}
              {turn.mapGraph ? <MapGraphView graph={visualGraphFromText(turn.mapGraph)} title="턴 맵 그래프" /> : null}
            </section>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ToolCallRow({ call }: { call: ToolCallRecord }) {
  return (
    <details className="tool-call-row">
      <summary>
        <span className="event-badge decision">{actionLabel(call.toolName)}</span>
        <span>{call.toolName}</span>
        {call.isGameAction ? <span className="chip">game</span> : null}
      </summary>
      <div className="tool-call-payloads">
        <pre className="mono-block">{json({ input: call.input })}</pre>
        <pre className="mono-block">{json({ output: call.output })}</pre>
      </div>
    </details>
  );
}

function commandSummary(turn: TurnRecord): string {
  const command = turn.parsedCommand;
  if (command?.type === "navigate") return `이동 y${value(command.y)} x${value(command.x)}`;
  if (command?.type === "wait") return `대기 ${value(command.frames)}f`;
  if (command?.type === "interact") return `상호작용 ${value(command.direction)}`;
  if (command?.type) return command.type;
  return actionLabel(turn.toolCalls?.find((call) => call.isGameAction)?.toolName);
}
