import type { MapMemoryResponse, PersistedMapRecord } from "../api/types";
import MapGraphView from "./MapGraphView";
import MapGrid from "./MapGrid";
import { connectionChips, mapMemoryStats, renderPersistedMap, tileCount, visualGraphFromMapMemory, warpCount } from "./mapVisuals";
import { isRecord, json, value } from "./shared";

export default function MapPanel({ payload }: { payload: MapMemoryResponse | null }) {
  const maps = payload?.maps ?? {};
  const entries = Object.entries(maps).sort(([a], [b]) => Number(a) - Number(b));
  const stats = mapMemoryStats(payload);

  if (entries.length === 0) {
    return <div className="empty">맵 데이터 대기 중...</div>;
  }

  return (
    <div className="map-panel">
      <section className="map-dashboard-summary">
        <div className="kv"><b>맵</b><span>{stats.mapCount}</span></div>
        <div className="kv"><b>타일</b><span>{stats.tileCount}</span></div>
        <div className="kv"><b>워프</b><span>{stats.warpCount}</span></div>
        <div className="kv"><b>연결</b><span>{stats.connectionCount}</span></div>
        <div className="kv span-2"><b>업데이트</b><span>{value(payload?.updatedAt)}</span></div>
      </section>

      <MapGraphView graph={visualGraphFromMapMemory(payload)} title="글로벌 맵 그래프" emptyText="아직 발견된 연결/워프가 없습니다" />

      <div className="map-card-grid">
        {entries.map(([mapId, record]) => <MapMemoryCard key={mapId} mapKey={mapId} record={record} />)}
      </div>
    </div>
  );
}

function MapMemoryCard({ mapKey, record }: { mapKey: string; record: PersistedMapRecord }) {
  const width = typeof record.width === "number" ? record.width : 0;
  const height = typeof record.height === "number" ? record.height : 0;
  const total = width > 0 && height > 0 ? width * height : 0;
  const explored = tileCount(record);
  const coverage = total > 0 ? `${Math.round((explored / total) * 100)}%` : "?";
  const chips = connectionChips(record);
  const npcCount = Array.isArray(record.knownNpcs) ? record.knownNpcs.length : 0;

  return (
    <article className="map-card">
      <header className="map-card-header">
        <div>
          <h3>{value(record.name, `맵 ${value(record.mapId, mapKey)}`)}</h3>
          <p>{width > 0 && height > 0 ? `${width}×${height}` : "크기 미확인"} · 탐색 {explored}/{total || "?"} ({coverage})</p>
        </div>
        <div className="map-card-badges">
          <span className="event-badge state">NPC {npcCount}</span>
          <span className="event-badge decision">WARP {warpCount(record)}</span>
        </div>
      </header>

      {chips.length > 0 ? <div className="map-chip-row">{chips.map((chip) => <span className="rule-chip" key={chip}>{chip}</span>)}</div> : null}

      <div className="map-section">
        <MapGrid ascii={renderPersistedMap(record)} />
      </div>

      {isRecord(record) ? (
        <details>
          <summary>원본 맵 메모리</summary>
          <pre className="collapsed-content">{json(record)}</pre>
        </details>
      ) : null}
    </article>
  );
}
