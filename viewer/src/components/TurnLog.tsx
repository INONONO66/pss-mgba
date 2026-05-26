import type { TurnsResponse } from "../api/types";
import { actionLabel } from "./labels";

export default function TurnLog({ payload }: { payload: TurnsResponse | null }) {
  const turns = payload?.turns ?? [];
  if (turns.length === 0) { return <div className="empty">턴 기록이 없습니다.</div>; }
  return (
    <div className="event-list">
      {turns.map((turn) => (
        <article className="event-item" key={turn.fileName ?? turn.turn}>
          <div className="event-header">
            <span className="event-badge action">턴 {turn.turn}</span>
            <span className="muted">{turn.toolCalls?.length ?? 0}개 기록</span>
          </div>
          <div className="event-body">
            {(turn.toolCalls ?? []).map((call) => (
              <div style={{ padding: "4px 0", borderBottom: "1px solid var(--line)" }} key={call.toolCallId}>
                <span className="event-badge decision">{actionLabel(call.toolName)}</span>
                {call.isGameAction ? <span className="chip" style={{ marginLeft: 6 }}>game</span> : null}
                <span className="muted" style={{ marginLeft: 6 }}>{call.isGameAction ? "게임 행동" : "보조 기록"}</span>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
