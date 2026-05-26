import { useState } from "react";
import type { EventsResponse, RunEvent } from "../api/types";
import { json } from "./shared";

function eventClass(type: string): string {
  if (["action", "error", "state", "decision"].includes(type)) { return type; }
  return "screenshot";
}

function rows(event: RunEvent): [string, string][] {
  const payload = event.payload ?? {};
  const result: [string, string][] = [];
  if (payload.command) { result.push(["명령", json(payload.command)]); }
  if (payload.action) { result.push(["행동", String(payload.action)]); }
  if (payload.result) { result.push(["결과", json(payload.result)]); }
  if (payload.rationale) { result.push(["근거", String(payload.rationale)]); }
  if (payload.frame !== undefined) { result.push(["프레임", String(payload.frame)]); }
  if (payload.step !== undefined) { result.push(["스텝", String(payload.step)]); }
  if (event.sequence !== undefined) { result.push(["시퀀스", String(event.sequence)]); }
  return result;
}

export default function EventLog({ payload }: { payload: EventsResponse | null }) {
  const [tab, setTab] = useState<"events" | "raw">("events");
  const events = payload?.events ?? [];
  return (
    <>
      <div className="panel-header"><h2>런 로그</h2><p>{events.length}개 이벤트</p></div>
      <div className="context-tabs"><button type="button" className={`tab ${tab === "events" ? "active" : ""}`} onClick={() => setTab("events")}>이벤트</button><button type="button" className={`tab ${tab === "raw" ? "active" : ""}`} onClick={() => setTab("raw")}>원본 로그</button></div>
      <div className="context-body scroll">
        {tab === "raw" ? <pre className="raw-log mono-block">{json(payload ?? { events: [] })}</pre> : <div className="event-list">{events.length === 0 ? <div className="empty">런 이벤트가 없습니다.</div> : events.map((event, index) => <article className="event-item" key={`${event.sequence ?? index}-${event.type}`}><div className="event-header"><span className={`event-badge ${eventClass(event.type)}`}>{event.type}</span><span className="muted">{event.timestamp}</span></div><div className="event-body">{rows(event).length > 0 ? <div className="kv-mini">{rows(event).map(([label, entry]) => <><b>{label}</b><span>{entry}</span></>)}</div> : null}<div className="event-payload"><pre>{json(event.payload ?? {})}</pre></div></div></article>)}</div>}
      </div>
    </>
  );
}
