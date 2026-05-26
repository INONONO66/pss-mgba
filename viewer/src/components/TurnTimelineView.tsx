import type { TurnTimelineEvent } from "../api/types";
import { json } from "./shared";
import Timeline from "./Timeline";
import { timelinePayload, timelineSummary, timelineTitle, timelineTone } from "./turnTimeline";

export default function TurnTimelineView({ events }: { events: TurnTimelineEvent[] }) {
  if (events.length === 0) {
    return <div className="empty compact">이 턴에 기록된 이벤트가 없습니다.</div>;
  }

  return (
    <Timeline
      steps={events.map((event) => {
        const payload = timelinePayload(event);
        return {
          title: timelineTitle(event),
          tone: timelineTone(event),
          children: (
            <div className="turn-event-detail">
              <div className="turn-event-summary">{timelineSummary(event)}</div>
              <div className="turn-event-meta">
                {event.timestamp ? <span>{event.timestamp}</span> : null}
                {event.toolCallId ? <span>{event.toolCallId}</span> : null}
                {event.isGameAction ? <span className="chip">game action</span> : null}
              </div>
              {payload !== undefined ? <pre className="mono-block compact-block">{json(payload)}</pre> : null}
            </div>
          ),
        };
      })}
    />
  );
}
