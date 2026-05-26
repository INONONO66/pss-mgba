import type { MapMemoryResponse, PersistedMapRecord } from "../api/types";
import MapGrid from "./MapGrid";
import { isRecord, json, value } from "./shared";

export default function MapPanel({ payload }: { payload: MapMemoryResponse | null }) {
  const maps = payload?.maps ?? {};
  const entries = Object.entries(maps);
  if (entries.length === 0) return <div className="empty">맵 데이터 대기 중...</div>;
  const totalTiles = entries.reduce((sum, [, record]) => sum + tileCount(record), 0);
  const totalWarps = entries.reduce((sum, [, record]) => sum + warpCount(record), 0);
  return (
    <div className="state-body scroll" style={{ display: "grid", gap: 10, alignContent: "start" }}>
      <div className="kv-grid">
        <div className="kv"><b>맵 수</b><span>{entries.length}</span></div>
        <div className="kv"><b>타일</b><span>{totalTiles}</span></div>
        <div className="kv"><b>워프</b><span>{totalWarps}</span></div>
        <div className="kv"><b>업데이트</b><span>{value(payload?.updatedAt)}</span></div>
      </div>
      {entries.map(([mapId, record]) => <MapCard mapId={mapId} record={record} key={mapId} />)}
    </div>
  );
}

function MapCard({ mapId, record }: { mapId: string; record: PersistedMapRecord }) {
  const width = numberValue(record.width);
  const height = numberValue(record.height);
  const tiles = isRecord(record.tiles) ? record.tiles : {};
  const coverage = width > 0 && height > 0 ? Math.round((Object.keys(tiles).length / (width * height)) * 100) : 0;
  const ascii = renderPersistedMap(record);
  return (
    <article className="event-item">
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

function renderPersistedMap(record: PersistedMapRecord): string {
  const width = numberValue(record.width);
  const height = numberValue(record.height);
  const tiles = isRecord(record.tiles) ? record.tiles : {};
  const warps = Array.isArray(record.warps) ? record.warps : [];
  if (width <= 0 || height <= 0) return json(record);
  const warpSet = new Set(warps.flatMap((warp) => isRecord(warp) ? [`${warp.y},${warp.x}`] : []));
  const lines: string[] = [];
  lines.push(`   ${Array.from({ length: width }, (_, index) => (index % 10).toString()).join("")}`);
  for (let y = 0; y < height; y += 1) {
    let line = `${y.toString().padStart(2, " ")} `;
    for (let x = 0; x < width; x += 1) {
      const key = `${y},${x}`;
      if (warpSet.has(key)) {
        line += "W";
      } else {
        const tile = tiles[key];
        line += tileChar(tile);
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function tileChar(tile: unknown): string {
  if (!isRecord(tile)) return "?";
  if (tile.type === "wall") return "#";
  if (tile.type === "grass") return '"';
  if (tile.type === "walkable") return ".";
  return "?";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function tileCount(record: unknown): number {
  return isRecord(record) && isRecord(record.tiles) ? Object.keys(record.tiles).length : 0;
}

function warpCount(record: unknown): number {
  return isRecord(record) && Array.isArray(record.warps) ? record.warps.length : 0;
}

function connectionChips(record: PersistedMapRecord): string[] {
  if (!isRecord(record.connections)) return [];
  return Object.entries(record.connections).map(([direction, target]) => `${direction} → ${value(target)}`);
}
