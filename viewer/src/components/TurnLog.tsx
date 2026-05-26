import type { TurnRecord, TurnsResponse } from "../api/types";
import { actionLabel } from "./labels";
import { detectorStatus, formatDuration, frameRange, gameActionLabel, runTurnStatus, sortedTurns, timelineSummary, timelineTitle, turnDurationMs, turnErrorCount } from "./turnTimeline";
import { json, value } from "./shared";

export default function TurnLog({ payload }: { payload: TurnsResponse | null }) {
  const turns = sortedTurns(payload);
  if (turns.length === 0) return <div className="empty">턴 기록이 없습니다.</div>;
  return (
    <div className="event-list">
      <RunRollup turns={turns} />
      {turns.map((turn) => <TurnCard turn={turn} key={turn.fileName ?? turn.turn} />)}
    </div>
  );
}

function RunRollup({ turns }: { turns: TurnRecord[] }) {
  const latest = turns[0];
  const errorTurns = turns.filter((turn) => turnErrorCount(turn) > 0).length;
  const gameActions = turns.flatMap((turn) => turn.toolCalls ?? []).filter((call) => call.isGameAction).length;
  return (
    <article className="event-item">
      <div className="event-header">
        <span className="event-badge state">런 타임라인</span>
        <span className="muted">{turns.length}턴 · 게임 행동 {gameActions}개 · 오류 턴 {errorTurns}개</span>
      </div>
      <div className="event-body">
        <div className="kv-grid">
          <div className="kv"><b>최신 턴</b><span>{value(latest?.turn)}</span></div>
          <div className="kv"><b>최신 상태</b><span>{latest ? runTurnStatus(latest) : "?"}</span></div>
          <div className="kv"><b>최신 행동</b><span>{latest ? gameActionLabel(latest) : "?"}</span></div>
          <div className="kv"><b>최신 프레임</b><span>{latest ? frameRange(latest) : "?"}</span></div>
        </div>
      </div>
    </article>
  );
}

function TurnCard({ turn }: { turn: TurnRecord }) {
  const errorCount = turnErrorCount(turn);
  const events = turn.timeline ?? [];
  const gameAction = turn.toolCalls?.find((call) => call.isGameAction) ?? turn.toolCalls?.[0];
  return (
    <article className="event-item">
      <div className="event-header">
        <span className="event-badge action">턴 {turn.turn}</span>
        <span className={errorCount > 0 ? "event-badge error" : "event-badge state"}>{runTurnStatus(turn)}</span>
        <span className="muted">{turn.fileName ?? "저장 전"}</span>
      </div>
      <div className="event-body">
        <div className="kv-grid">
          <div className="kv"><b>행동</b><span>{actionLabel(gameAction?.toolName)}</span></div>
          <div className="kv"><b>도구/이벤트</b><span>{turn.toolCalls?.length ?? 0} / {events.length}</span></div>
          <div className="kv"><b>프레임</b><span>{frameRange(turn)}</span></div>
          <div className="kv"><b>소요시간</b><span>{formatDuration(turnDurationMs(turn))}</span></div>
          <div className="kv"><b>검출기</b><span>{detectorStatus(turn)}</span></div>
          <div className="kv"><b>오류</b><span>{errorCount > 0 ? `${errorCount}건` : "없음"}</span></div>
        </div>
        {events.length > 0 ? <div className="turn-mini-timeline">
          {events.slice(0, 6).map((event) => (
            <div className="state-summary-item" key={`${turn.turn}-${event.sequence}-${event.type}`}>
              <b>{timelineTitle(event)}</b>
              {timelineSummary(event)}
            </div>
          ))}
          {events.length > 6 ? <div className="muted">+{events.length - 6}개 이벤트 더 있음</div> : null}
        </div> : <div className="muted">타임라인 이벤트 없음</div>}
        {turn.parsedCommand ? <details><summary>parsed command</summary><pre className="mono-block">{json(turn.parsedCommand)}</pre></details> : null}
      </div>
    </article>
  );
}
