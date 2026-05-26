import type { MapMemoryResponse } from "../api/types";
import { json, value } from "./shared";

export default function MapPanel({ payload }: { payload: MapMemoryResponse | null }) {
  const maps = payload?.maps ?? {};
  const entries = Object.entries(maps);
  if (entries.length === 0) { return <div className="empty">맵 데이터 대기 중...</div>; }
  return (
    <div className="state-body scroll" style={{ display: "grid", gap: 10, alignContent: "start" }}>
      <div className="kv-grid">
        <div className="kv"><b>맵 수</b><span>{entries.length}</span></div>
        <div className="kv"><b>업데이트</b><span>{value(payload?.updatedAt)}</span></div>
      </div>
      {entries.map(([mapId, record]) => (
        <article className="event-item" key={mapId}>
          <div className="event-header"><span className="event-badge state">맵 {mapId}</span></div>
          <pre className="mono-block">{json(record)}</pre>
        </article>
      ))}
    </div>
  );
}
