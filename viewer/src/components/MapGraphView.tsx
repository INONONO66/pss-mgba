import type { VisualGraph } from "./mapVisuals";
import { value } from "./shared";

export default function MapGraphView({ emptyText = "맵 그래프 없음", graph, title = "맵 그래프" }: { emptyText?: string; graph: VisualGraph; title?: string }) {
  if (graph.edges.length === 0) {
    return <div className="map-graph-card"><h3>{title}</h3><div className="empty compact">{emptyText}</div></div>;
  }

  return (
    <div className="map-graph-card">
      <div className="map-graph-header">
        <h3>{title}</h3>
        <span className="muted">노드 {graph.nodeCount} · 연결 {graph.edges.length}{graph.currentLabel ? ` · 현재 ${graph.currentLabel}` : ""}</span>
      </div>
      <div className="map-graph-visual">
        {graph.edges.map((edge, index) => (
          <div className="map-edge" key={`${edge.fromLabel}-${edge.detail}-${edge.toLabel}-${index}`}>
            <span className="map-node">{edge.fromLabel}</span>
            <span className={`map-edge-kind ${edge.kind}`}>{edge.kind === "warp" ? "워프" : "연결"}</span>
            <span className="map-edge-detail">{value(edge.detail)}</span>
            <span className="map-arrow">→</span>
            <span className="map-node target">{edge.toLabel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
