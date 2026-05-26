import type { NpcCellInfo } from "./mapVisuals";

interface MapGridProps {
  ascii?: string | null;
  npcCells?: Map<string, NpcCellInfo>;
}

const ROW_RE = /^\s*(\d+)\s+([.#"?@NIW~]+)\s*$/;

function mapCellClass(char: string | undefined): string {
  if (char === "@") { return "player"; }
  if (char === "#") { return "wall"; }
  if (char === ".") { return "walk"; }
  if (char === "\"") { return "grass"; }
  if (char === "~") { return "water"; }
  if (char === "N") { return "npc"; }
  if (char === "I") { return "item"; }
  if (char === "W") { return "warp"; }
  return "unknown";
}

function parseRows(ascii: string): { row: string; y: number }[] {
  const result: { row: string; y: number }[] = [];
  for (const line of ascii.split("\n")) {
    const m = line.match(ROW_RE);
    if (m) {
      result.push({ row: m[2], y: Number(m[1]) });
    }
  }
  return result;
}

export default function MapGrid({ ascii, npcCells }: MapGridProps) {
  if (!ascii) { return null; }
  const parsed = parseRows(ascii);
  if (parsed.length === 0) { return <pre className="mono-block">{ascii}</pre>; }
  const maxCols = Math.max(...parsed.map((r) => r.row.length));
  const legend = [["player", "@ 플레이어"], ["wall", "# 벽"], ["walk", ". 이동가능"], ["grass", "\" 풀"], ["water", "~ 물"], ["npc", "N NPC"], ["item", "I 아이템"], ["warp", "W 워프"], ["unknown", "? 미확인"]];
  return (
    <div>
      <div className="map-grid" style={{ gridTemplateColumns: `repeat(${maxCols}, 16px)` }}>
        {parsed.flatMap(({ row, y }) => Array.from({ length: maxCols }, (_, colIndex) => {
          const char = row[colIndex] ?? " ";
          const npc = npcCells?.get(`${y},${colIndex}`);
          const tooltip = npc ? `#${npc.slot} ${npc.name} (${npc.kind === "item" ? "Item" : "NPC"}) at (${npc.mapX},${npc.mapY})` : undefined;
          return <div className={`map-cell ${mapCellClass(char)}`} key={`${y}-${colIndex}`} title={tooltip}>{char}</div>;
        }))}
      </div>
      <div className="map-legend">{legend.map(([cls, label]) => <span key={cls}><span className={`swatch ${cls}`} />{label}</span>)}</div>
    </div>
  );
}
