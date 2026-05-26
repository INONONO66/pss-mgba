import type { GameStateResponse, RunSummary } from "../api/types";
import { stateFields, summarizeAction, value } from "./shared";

export default function TopBar({ summary, gameState, refreshedAt }: { summary: RunSummary | null; gameState: GameStateResponse | null; refreshedAt: Date }) {
  const latest = gameState?.latest;
  const state = latest ? stateFields(latest) : null;
  const counts = summary?.counts ?? {};
  const status = summary?.status ?? "로딩 중...";
  return (
    <section className="topbar" aria-label="런 요약">
      <article className="card"><div className="label">런 ID</div><div className="value">{summary?.runId ?? gameState?.runId ?? "대기 중"}</div></article>
      <article className="card"><div className="label">상태</div><div className={`value ${status.startsWith("failed") ? "bad" : "muted"}`}>{status}</div></article>
      <article className="card"><div className="label">진행</div><div className="value muted">스텝 {value(summary?.totalSteps)} · 턴 {counts.turns ?? 0} · 오류 {counts.errors ?? 0}</div></article>
      <article className="card"><div className="label">맵</div><div className="value muted">{state ? `${state.mapName ? `${state.mapName} ` : ""}맵 ${value(state.mapId)} · y${value(state.y)} x${value(state.x)}` : "상태 없음"}</div></article>
      <article className="card"><div className="label">파티</div><div className="value muted">{state?.partyText ?? "상태 없음"}</div></article>
      <article className="card"><div className="label">플레이어 행동</div><div className="value muted">{summary?.lastAction ? `${summarizeAction({ parsedDecision: summary.lastAction })} · ${summary.lastAction.rationale ?? "근거 없음"}` : "플레이어 행동 없음"}</div></article>
      <article className="card"><div className="label">갱신</div><div className="value muted">{refreshedAt.toLocaleTimeString()}</div></article>
    </section>
  );
}
