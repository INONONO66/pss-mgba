import type { MapMemoryResponse, PersistedMapRecord } from "../api/types";
import MapGraphView from "./MapGraphView";
import MapGrid from "./MapGrid";
import { connectionChips, mapMemoryStats, renderPersistedMap, visualGraphFromMapMemory, warpCount } from "./mapVisuals";
import { json, value } from "./shared";

export default function MapPanel({ payload }: { payload: MapMemoryResponse | null }) {
  const maps = payload?.maps ?? {};
  const entries = Object.entries(maps);
  if (entries.length === 0) return <div className="empty">맵 데이터 대기 중...</div>;
  const stats = mapMemoryStats(payload);
  const graph = visualGraphFromMapMemory(payload);
  return (
    <div className="state-body scroll" style={{ display: "grid", gap: 10, alignContent: "start" }}>
      <div className="kv-grid">
        <div className="kv"><b>맵 수</b><span>{stats.mapCount}</span></div>
        <div className="kv"><b>타일</b><span>{stats.tileCount}</span></div>
        <div className="kv"><b>워프/연결</b><span>{stats.warpCount} / {stats.connectionCount}</span></div>
        <div className="kv"><b>업데이트</b><span>{value(payload?.updatedAt)}</span></div>
      </div>
      <MapGraphView graph={graph} title="전역 맵 그래프" emptyText="저장된 워프/연결 그래프가 없습니다." />
      {entries.map(([mapId, record]) => <MapCard mapId={mapId} record={record} key={mapId} />)}
    </div>
  );
}

function MapCard({ mapId, record }: { mapId: string; record: PersistedMapRecord }) {
  const width = numberValue(record.width);
  const height = numberValue(record.height);
  const tiles = record.tiles ?? {};
  const coverage = width > 0 && height > 0 ? Math.round((Object.keys(tiles).length / (width * height)) * 100) : 0;
  const ascii = renderPersistedMap(record);
  return (
    <article className="event-item map-card">
      <div className="event-header">
        <span className="event-badge state">맵 {value(record.mapId, mapId)}</span>
        <span className="muted">{width}x{height} · {coverage}% 탐색 · 워프 {warpCount(record)}</span>
      </div>
      <div className="event-body">
        <div className="map-section"><MapGrid ascii={ascii} /></div>
        <div className="status-line" style={{ marginTop: 8 }}>
          {connectionChips(record).map((chip) => <span className="chip" key={chip}>{chip}</span>)}
        </div>
        <details><summary>raw map record</summary><pre className="mono-block">{json(record)}</pre></details>
      </div>
    </article>
  );
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
