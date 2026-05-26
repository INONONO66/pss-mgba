import type { GameStateResponse, GameStateSnapshot } from "../api/types";
import MapGrid from "./MapGrid";
import { boolText, isRecord, json, mapAsciiFromState, stateFields, unwrapState, value } from "./shared";

function stateEntries(snapshot: GameStateSnapshot) {
  const fields = stateFields(snapshot);
  const state = fields.state;
  const party = isRecord(state.party) ? state.party : {};
  const battle = isRecord(state.battle) ? state.battle : {};
  const rootState = isRecord(snapshot.state) ? snapshot.state : {};
  return [
    ["스냅샷", `스텝 ${value(rootState.step ?? snapshot.step)} · 프레임 ${value(rootState.frame ?? snapshot.frame)}`],
    ["위치", `${fields.mapName ? `${fields.mapName} · ` : ""}맵 ${value(fields.mapId)} · y=${value(fields.y)} x=${value(fields.x)} · ${value(fields.facing)}`],
    ["진행도", `배지 ${value(fields.badgeCount, "0")} · 명예의 전당 ${boolText(Boolean(state.hallOfFameComplete))}`],
    ["파티", fields.partyText],
    ["배틀", `${value(battle.type ?? battle.kind ?? (state.wIsInBattle ? "배틀" : "없음"))}${isRecord(battle.enemy) ? ` · 적 ${value(battle.enemy.species)} Lv${value(battle.enemy.level)}` : ""}`],
    ["대화/메뉴", `활성 ${boolText(Boolean(fields.dialog))} · 텍스트박스 ${value(isRecord(state.dialog) ? state.dialog.textBoxId : state.textBoxId ?? state.wTextBoxID)} · 메뉴 ${value(isRecord(state.menuText) ? state.menuText.currentMenuItem : state.menuItem)}`]
  ];
}

export default function GameState({ payload }: { payload: GameStateResponse | null }) {
  const latest = payload?.latest;
  if (!latest) {
    return <article className="panel state-panel"><div className="panel-header"><h2>현재 상태</h2><p>게임 상태 스냅샷 없음</p></div><div className="empty">RAM 스냅샷 대기 중...</div></article>;
  }
  const state = unwrapState(latest);
  const fields = stateFields(latest);
  return (
    <article className="panel state-panel">
      <div className="panel-header"><h2>현재 상태</h2><p>{payload.count}/{payload.limit} 스냅샷 · 최신 {latest.fileName}</p></div>
      <div className="state-body scroll"><div className="state-block">
        <div className="kv-grid">{stateEntries(latest).map(([label, entry]) => <div className="kv" key={label}><b>{label}</b><span>{entry}</span></div>)}</div>
        <div className="map-section"><h3>맵</h3><MapGrid ascii={mapAsciiFromState(state)} /></div>
        {fields.dialog ? <pre className="mono-block">대화/텍스트{"\n"}{fields.dialog}</pre> : null}
        {latest.error ? <pre className="mono-block">{json(latest.error)}</pre> : null}
      </div></div>
    </article>
  );
}
