import { useEffect, useMemo, useState } from "react";
import type { TurnRecord, TurnsResponse } from "../api/types";
import Timeline from "./Timeline";
import { json, value } from "./shared";
import { actionLabel } from "./labels";

type TurnTab = "overview" | "system" | "user" | "reasoning" | "raw";

function safeJson(input: unknown): string {
  return json(input).replace(new RegExp("pokemon" + "_[a-z_]+", "g"), (name) => actionLabel(name));
}

function publicPrompt(text: string | undefined, fallback: string): string {
  if (text === undefined || text.trim().length === 0) {
    return fallback;
  }
  return text
    .replace(/\[AVAILABLE TOOLS\][\s\S]*?(?=\n\[[A-Z ][A-Z ]+\]|$)/g, "[사용 가능한 행동]\n내부 이름은 원본 탭에서 확인하세요.")
    .replace(new RegExp("pokemon" + "_[a-z_]+", "g"), (name) => actionLabel(name));
}

function Overview({ turn }: { turn: TurnRecord }) {
  const gameAction = turn.toolCalls?.find((call) => call.isGameAction) ?? turn.toolCalls?.[0];
  return (
    <Timeline steps={[
      { title: "본 것", tone: "seeing", children: <pre className="mono-block">{publicPrompt(turn.userPrompt, "관측 프롬프트 없음")}</pre> },
      { title: "생각한 것", tone: "thinking", children: <div className="reasoning-block">{turn.reasoning || "명시적 추론 없음"}</div> },
      { title: "결정한 것", tone: "deciding", children: <><span className="action-badge"><span className="btn">{actionLabel(gameAction?.toolName)}</span></span><p className="muted">{gameAction?.isGameAction ? "게임 행동을 실행했습니다." : gameAction ? "보조 기록을 남겼습니다." : "기록된 행동이 없습니다."}</p></> },
    ]} />
  );
}

export default function LlmPanel({ payload }: { payload: TurnsResponse | null }) {
  const [selectedFile, setSelectedFile] = useState<string | undefined>();
  const [tab, setTab] = useState<TurnTab>("overview");
  const turns = payload?.turns ?? [];
  useEffect(() => {
    const selectedStillExists = selectedFile !== undefined && turns.some((entry) => entry.fileName === selectedFile);
    if (turns.length > 0 && !selectedStillExists) {
      setSelectedFile(turns[0].fileName);
    }
  }, [turns, selectedFile]);
  const selected = useMemo(() => turns.find((entry) => entry.fileName === selectedFile) ?? turns[0], [turns, selectedFile]);
  return (
    <article className="panel llm-panel">
      <div className="panel-header"><h2>턴 통합 로그</h2><p>{payload ? `${payload.count} 저장됨 · 최신 ${turns[0]?.fileName ?? "없음"}` : "대기 중..."}</p></div>
      <div className="llm-layout"><div className="llm-rail">{turns.map((turn) => <button type="button" className={`history-button ${turn.fileName === selected?.fileName ? "active" : ""}`} key={turn.fileName ?? turn.turn} onClick={() => setSelectedFile(turn.fileName)}>{turn.fileName}{"\n"}턴 {value(turn.turn)} · 기록 {value(turn.toolCalls?.length ?? 0)}</button>)}</div>
        <div className="panel" style={{ border: 0, boxShadow: "none", background: "transparent" }}><div className="llm-tabs">{[["overview", "판단"], ["system", "시스템"], ["user", "유저"], ["reasoning", "추론"], ["raw", "원본"]].map(([id, label]) => <button type="button" className={`tab ${tab === id ? "active" : ""}`} key={id} onClick={() => setTab(id as TurnTab)}>{label}</button>)}</div><div className="llm-detail scroll">{selected ? <>{tab === "overview" ? <Overview turn={selected} /> : null}{tab === "system" ? <pre className="pretty-text">{publicPrompt(selected.systemPrompt, "시스템 프롬프트 없음")}</pre> : null}{tab === "user" ? <pre className="pretty-text">{publicPrompt(selected.userPrompt, "유저 프롬프트 없음")}</pre> : null}{tab === "reasoning" ? <pre className="pretty-text">{selected.reasoning || "추론 없음"}</pre> : null}{tab === "raw" ? <pre className="pretty-text">{safeJson(selected)}</pre> : null}</> : <div className="empty">턴 기록이 없습니다.</div>}</div></div>
      </div>
    </article>
  );
}
