interface MapGridProps { ascii?: string | null; }

const ROW_RE = /^\s*\d+\s+([.#"?@NW]+)\s*$/;

function mapCellClass(char: string | undefined): string {
  if (char === "@") { return "player"; }
  if (char === "#") { return "wall"; }
  if (char === ".") { return "walk"; }
  if (char === "\"") { return "grass"; }
  if (char === "N") { return "npc"; }
  if (char === "W") { return "warp"; }
  return "unknown";
}

export default function MapGrid({ ascii }: MapGridProps) {
  if (!ascii) { return null; }
  const rows = ascii.split("\n").map((line) => line.match(ROW_RE)?.[1]).filter((row): row is string => Boolean(row));
  if (rows.length === 0) { return <pre className="mono-block">{ascii}</pre>; }
  const maxCols = Math.max(...rows.map((row) => row.length));
  const legend = [["player", "@ 플레이어"], ["wall", "# 벽"], ["walk", ". 이동가능"], ["grass", "\" 풀"], ["npc", "N NPC"], ["warp", "W 워프"], ["unknown", "? 미확인"]];
  return (
    <div>
      <div className="map-grid" style={{ gridTemplateColumns: `repeat(${maxCols}, 16px)` }}>
        {rows.flatMap((row, rowIndex) => Array.from({ length: maxCols }, (_, colIndex) => {
          const char = row[colIndex] ?? " ";
          return <div className={`map-cell ${mapCellClass(char)}`} key={`${rowIndex}-${colIndex}`}>{char}</div>;
        }))}
      </div>
      <div className="map-legend">{legend.map(([cls, label]) => <span key={cls}><span className={`swatch ${cls}`} />{label}</span>)}</div>
    </div>
  );
}
