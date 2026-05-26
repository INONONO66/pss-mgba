import type { GameStateResponse } from "../api/types";
import { isRecord, unwrapState, value } from "./shared";

function hpFillClass(pct: number): string {
  if (pct > 50) { return "v2-hp-bar-fill v2-hp-green"; }
  if (pct > 20) { return "v2-hp-bar-fill v2-hp-amber"; }
  return "v2-hp-bar-fill v2-hp-red";
}

function PokemonCard({ mon, side }: { mon: Record<string, unknown>; side: "ally" | "enemy" }) {
  const hp = typeof mon.hp === "number" ? mon.hp : 0;
  const maxHp = typeof mon.maxHp === "number" ? mon.maxHp : 1;
  const pct = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 0;
  const nameColor = side === "ally" ? "var(--green)" : "var(--red)";

  return (
    <div className={`v2-pokemon-card ${side}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="v2-pokemon-name" style={{ color: nameColor }}>{value(mon.nickname ?? mon.species, "???")}</span>
        <span className="v2-pokemon-level">Lv{value(mon.level, "?")}</span>
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", font: "10px/1 var(--mono)", marginBottom: 4 }}>
          <span style={{ color: "var(--ink)" }}>HP</span>
          <span className="muted">{hp}/{maxHp}</span>
        </div>
        <div className="v2-hp-bar">
          <div className={hpFillClass(pct)} style={{ width: `${pct}%` }} />
        </div>
      </div>
      {mon.status ? <span className="chip warn">{String(mon.status)}</span> : null}
      {Array.isArray(mon.moves) ? (
        <div className="v2-moves">
          {(mon.moves as unknown[]).map((move, i) => (
            <span key={isRecord(move) ? String(move.name ?? i) : String(i)} className="v2-move">
              {isRecord(move) ? value(move.name, "???") : String(move)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function BattlePanel({ gameState }: { gameState: GameStateResponse | null }) {
  const latest = gameState?.latest;
  if (!latest) {
    return <div className="empty">게임 상태 대기 중...</div>;
  }

  const state = unwrapState(latest);
  const battle = isRecord(state.battle) ? state.battle : {};
  const inBattle = Boolean(battle.inBattle ?? battle.kind ?? state.wIsInBattle);

  if (!inBattle) {
    return (
      <div className="v2-battle-empty">
        <div>
          <div style={{ font: "24px/1 var(--mono)", marginBottom: 8 }}>&#x2694;&#xfe0f;</div>
          <div className="muted" style={{ fontSize: 13 }}>현재 배틀 중이 아닙니다</div>
          <div style={{ color: "var(--muted-2)", font: "10px/1.4 var(--mono)", marginTop: 4 }}>배틀이 시작되면 여기에 실시간 정보가 표시됩니다</div>
        </div>
      </div>
    );
  }

  const ally = isRecord(battle.ally) ? battle.ally : {};
  const enemy = isRecord(battle.enemy) ? battle.enemy : {};
  const battleType = value(battle.type ?? battle.kind, "야생");
  const turnCount = typeof battle.turnCount === "number" ? battle.turnCount : undefined;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span className="chip">{battleType} 배틀</span>
        {turnCount !== undefined ? <span className="chip">턴 {turnCount}</span> : null}
      </div>
      <div className="v2-battle-grid">
        <div>
          <span className="label" style={{ marginBottom: 8, display: "block" }}>아군</span>
          {Object.keys(ally).length > 0 ? <PokemonCard mon={ally} side="ally" /> : <div className="kv"><b>상태</b><span>아군 데이터 없음</span></div>}
        </div>
        <div>
          <span className="label" style={{ color: "var(--red)", marginBottom: 8, display: "block" }}>적</span>
          {Object.keys(enemy).length > 0 ? <PokemonCard mon={enemy} side="enemy" /> : <div className="kv"><b>상태</b><span>적 데이터 없음</span></div>}
        </div>
      </div>
    </div>
  );
}
