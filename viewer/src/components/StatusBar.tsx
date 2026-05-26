import { useViewerState } from "../store/ViewerStore";
import { isRecord, stateFields, value } from "./shared";

function hpFillClass(pct: number): string {
  if (pct > 50) { return "v2-hp-fill v2-hp-green"; }
  if (pct > 20) { return "v2-hp-fill v2-hp-amber"; }
  return "v2-hp-fill v2-hp-red";
}

export default function StatusBar() {
  const { gameState, summary } = useViewerState();
  const latest = gameState?.latest;
  const fields = latest ? stateFields(latest) : null;
  const state = fields?.state;
  const party = isRecord(state?.party) ? state.party : {};
  const members = Array.isArray(party.members) ? party.members : [];

  return (
    <footer className="card v2-statusbar">
      <div className="v2-party-row">
        {members.length > 0 ? members.map((mon: unknown, i: number) => {
          if (!isRecord(mon)) { return null; }
          const hp = typeof mon.hp === "number" ? mon.hp : 0;
          const maxHp = typeof mon.maxHp === "number" ? mon.maxHp : 1;
          const pct = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 0;
          return (
            <div key={`party-${i}`} className="v2-party-mon">
              <span className="v2-party-name">{value(mon.nickname ?? mon.species, `#${i + 1}`)}</span>
              <div className="v2-hp-track">
                <div className={hpFillClass(pct)} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        }) : <span className="muted" style={{ font: "500 10px/1 var(--mono)" }}>파티 없음</span>}
      </div>

      <div className="v2-divider" />

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="chip">{fields ? `맵 ${value(fields.mapId)}` : "..."}</span>
        <span className="chip">{fields ? `y${value(fields.y)} x${value(fields.x)}` : "..."}</span>
        <span className="chip">배지 {value(fields?.badgeCount, "0")}</span>
      </div>

      <div className="v2-divider" />

      <div className="v2-rationale">
        {summary?.lastAction?.rationale ?? "행동 대기 중"}
      </div>
    </footer>
  );
}
