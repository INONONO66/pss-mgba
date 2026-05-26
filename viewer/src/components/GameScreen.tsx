import { useEffect, useState } from "react";
import type { GameStateResponse } from "../api/types";
import { stateFields, value } from "./shared";

export default function GameScreen({ gameState, runId }: { gameState: GameStateResponse | null; runId?: string }) {
  const [nonce, setNonce] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNonce(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const fields = gameState?.latest ? stateFields(gameState.latest) : null;
  return (
    <article className="panel screen-panel">
      <div className="panel-header"><h1>실시간 게임 화면</h1><p>mGBA 프레임 · <code>{runId ?? gameState?.runId ?? "run"}</code></p></div>
      <div className="screen-wrap">
        <img className="live-frame" src={`/api/live-frame?nonce=${nonce}`} alt="실시간 mGBA 화면" />
        <div className="screen-hud">
          <div className="status-line">
            {fields ? [
              `맵 ${value(fields.mapId)}`,
              `y${value(fields.y)} x${value(fields.x)}`,
              `방향 ${value(fields.facing)}`,
              `배지 ${value(fields.badgeCount, "0")}`,
              `배틀 ${value(fields.battle)}`
            ].map((chip) => <span className="chip" key={chip}>{chip}</span>) : <span className="chip warn">상태 대기 중</span>}
          </div>
          <div className="muted">{fields?.dialog || "활성 대화/텍스트 없음"}</div>
        </div>
      </div>
    </article>
  );
}
