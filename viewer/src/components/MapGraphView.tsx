import { useMemo, useState, useCallback } from "react";
import type { VisualGraph, VisualGraphEdge } from "./mapVisuals";

interface NodePos {
  id: string;
  label: string;
  mapId?: number;
  x: number;
  y: number;
  isCurrent: boolean;
}

interface LayoutEdge {
  from: NodePos;
  to: NodePos;
  edge: VisualGraphEdge;
}

const NODE_W = 120;
const NODE_H = 34;
const PAD = 40;

function layoutNodes(graph: VisualGraph): { nodes: NodePos[]; edges: LayoutEdge[]; width: number; height: number } {
  const nodeMap = new Map<string, NodePos>();
  const allLabels = new Set<string>();

  for (const e of graph.edges) {
    allLabels.add(e.fromLabel);
    allLabels.add(e.toLabel);
  }

  const labels = Array.from(allLabels);
  if (labels.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const currentIdx = graph.currentLabel ? labels.indexOf(graph.currentLabel) : -1;
  if (currentIdx > 0) {
    const [cur] = labels.splice(currentIdx, 1);
    labels.unshift(cur);
  }

  const cols = Math.max(2, Math.ceil(Math.sqrt(labels.length)));
  const spacingX = NODE_W + 60;
  const spacingY = NODE_H + 56;

  for (let i = 0; i < labels.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const edge = graph.edges.find((e) => e.fromLabel === labels[i] || e.toLabel === labels[i]);
    nodeMap.set(labels[i], {
      id: labels[i],
      label: labels[i],
      mapId: edge?.fromLabel === labels[i] ? edge.fromMapId : edge?.toMapId,
      x: PAD + col * spacingX + NODE_W / 2,
      y: PAD + row * spacingY + NODE_H / 2,
      isCurrent: labels[i] === graph.currentLabel,
    });
  }

  const nodes = Array.from(nodeMap.values());
  const layoutEdges: LayoutEdge[] = [];

  for (const e of graph.edges) {
    const from = nodeMap.get(e.fromLabel);
    const to = nodeMap.get(e.toLabel);
    if (from && to) {
      layoutEdges.push({ from, to, edge: e });
    }
  }

  const maxX = Math.max(...nodes.map((n) => n.x)) + NODE_W / 2 + PAD;
  const maxY = Math.max(...nodes.map((n) => n.y)) + NODE_H / 2 + PAD;

  return { nodes, edges: layoutEdges, width: maxX, height: maxY };
}

function edgePath(from: NodePos, to: NodePos): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return "";

  const nx = dx / dist;
  const ny = dy / dist;

  const sx = from.x + nx * (NODE_W / 2 + 4);
  const sy = from.y + ny * (NODE_H / 2 + 4);
  const ex = to.x - nx * (NODE_W / 2 + 8);
  const ey = to.y - ny * (NODE_H / 2 + 8);

  const cx = (sx + ex) / 2 + ny * 20;
  const cy = (sy + ey) / 2 - nx * 20;

  return `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`;
}

function kindColor(kind: string): string {
  if (kind === "warp") return "rgba(180,140,255,0.7)";
  return "rgba(255,200,87,0.7)";
}

export default function MapGraphView({
  emptyText = "맵 그래프 없음",
  graph,
  title = "맵 그래프",
}: {
  emptyText?: string;
  graph: VisualGraph;
  title?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const layout = useMemo(() => layoutNodes(graph), [graph]);

  const handleHover = useCallback((label: string | null) => setHovered(label), []);

  if (layout.nodes.length === 0) {
    return (
      <div className="map-graph-card">
        <h3>{title}</h3>
        <div className="empty compact">{emptyText}</div>
      </div>
    );
  }

  const svgW = Math.max(layout.width, 300);
  const svgH = Math.max(layout.height, 200);

  return (
    <div className="map-graph-card">
      <div className="map-graph-header">
        <h3>{title}</h3>
        <span className="muted">
          노드 {layout.nodes.length} · 연결 {layout.edges.length}
          {graph.currentLabel ? ` · 현재 ${graph.currentLabel}` : ""}
        </span>
      </div>
      <div className="mg-svg-wrap">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          width="100%"
          height={svgH}
          style={{ maxHeight: 420, display: "block" }}
        >
          <defs>
            <marker id="mg-arrow-warp" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6" fill="rgba(180,140,255,0.7)" />
            </marker>
            <marker id="mg-arrow-conn" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6" fill="rgba(255,200,87,0.7)" />
            </marker>
          </defs>

          {layout.edges.map((le, i) => {
            const d = edgePath(le.from, le.to);
            if (!d) return null;
            const isHighlighted = hovered === le.from.id || hovered === le.to.id;
            const markerEnd = le.edge.kind === "warp" ? "url(#mg-arrow-warp)" : "url(#mg-arrow-conn)";
            return (
              <g key={`e-${i}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={kindColor(le.edge.kind)}
                  strokeWidth={isHighlighted ? 2.5 : 1.5}
                  strokeDasharray={le.edge.kind === "warp" ? "6,3" : "none"}
                  markerEnd={markerEnd}
                  opacity={hovered && !isHighlighted ? 0.25 : 0.85}
                  style={{ transition: "opacity 0.15s, stroke-width 0.15s" }}
                />
                {isHighlighted && le.edge.detail && (
                  <text
                    x={(le.from.x + le.to.x) / 2}
                    y={(le.from.y + le.to.y) / 2 - 8}
                    fill="var(--muted)"
                    fontSize={9}
                    fontFamily="var(--mono)"
                    textAnchor="middle"
                  >
                    {le.edge.detail}
                  </text>
                )}
              </g>
            );
          })}

          {layout.nodes.map((node) => {
            const isHighlighted = hovered === node.id;
            const isAdj = layout.edges.some(
              (le) => (le.from.id === hovered && le.to.id === node.id) || (le.to.id === hovered && le.from.id === node.id)
            );
            const dimmed = hovered !== null && !isHighlighted && !isAdj;

            return (
              <g
                key={node.id}
                onMouseEnter={() => handleHover(node.id)}
                onMouseLeave={() => handleHover(null)}
                style={{ cursor: "pointer", transition: "opacity 0.15s" }}
                opacity={dimmed ? 0.3 : 1}
              >
                <rect
                  x={node.x - NODE_W / 2}
                  y={node.y - NODE_H / 2}
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  fill={node.isCurrent ? "rgba(140,255,113,0.18)" : "rgba(13,21,15,0.92)"}
                  stroke={
                    node.isCurrent
                      ? "rgba(140,255,113,0.6)"
                      : isHighlighted
                        ? "rgba(126,200,227,0.5)"
                        : "rgba(196,255,166,0.2)"
                  }
                  strokeWidth={node.isCurrent || isHighlighted ? 2 : 1}
                />
                {node.isCurrent && (
                  <circle
                    cx={node.x - NODE_W / 2 + 10}
                    cy={node.y}
                    r={3}
                    fill="var(--green)"
                  >
                    <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                )}
                <text
                  x={node.x + (node.isCurrent ? 4 : 0)}
                  y={node.y + 1}
                  fill={node.isCurrent ? "#f7ffe4" : "var(--ink)"}
                  fontSize={10}
                  fontFamily="var(--mono)"
                  fontWeight={node.isCurrent ? 700 : 500}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
