import { useEffect, useMemo, useState } from "react";
import type { TurnRecord, TurnsResponse } from "../api/types";
import Timeline from "./Timeline";
import { json, value } from "./shared";

type TurnTab = "overview" | "system" | "user" | "reasoning" | "raw";

function Overview({ turn }: { turn: TurnRecord }) {
  const gameAction = turn.toolCalls?.find((call) => call.isGameAction) ?? turn.toolCalls?.[0];
  return (
    <Timeline steps={[
      { title: "본 것", tone: "seeing", children: <pre className="mono-block">{turn.userPrompt ?? "유저 프롬프트 없음"}</pre> },
      { title: "생각한 것", tone: "thinking", children: <div className="reasoning-block">{turn.reasoning || "명시적 추론 없음"}</div> },
      { title: "결정한 것", tone: "deciding", children: <><span className="action-badge"><span className="btn">{gameAction?.toolName ?? "대기"}</span></span><pre className="mono-block">{json(gameAction ?? turn.parsedCommand ?? {})}</pre></> },
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
      <div className="llm-layout"><div className="llm-rail">{turns.map((turn) => <button type="button" className={`history-button ${turn.fileName === selected?.fileName ? "active" : ""}`} key={turn.fileName ?? turn.turn} onClick={() => setSelectedFile(turn.fileName)}>{turn.fileName}{"\n"}턴 {value(turn.turn)} · 도구 {value(turn.toolCalls?.length ?? 0)}</button>)}</div>
        <div className="panel" style={{ border: 0, boxShadow: "none", background: "transparent" }}><div className="llm-tabs">{[["overview", "판단"], ["system", "시스템"], ["user", "유저"], ["reasoning", "추론"], ["raw", "원본"]].map(([id, label]) => <button type="button" className={`tab ${tab === id ? "active" : ""}`} key={id} onClick={() => setTab(id as TurnTab)}>{label}</button>)}</div><div className="llm-detail scroll">{selected ? <>{tab === "overview" ? <Overview turn={selected} /> : null}{tab === "system" ? <pre className="pretty-text">{selected.systemPrompt ?? "시스템 프롬프트 없음"}</pre> : null}{tab === "user" ? <pre className="pretty-text">{selected.userPrompt ?? "유저 프롬프트 없음"}</pre> : null}{tab === "reasoning" ? <pre className="pretty-text">{selected.reasoning || "추론 없음"}</pre> : null}{tab === "raw" ? <pre className="pretty-text">{json(selected)}</pre> : null}</> : <div className="empty">턴 기록이 없습니다.</div>}</div></div>
      </div>
    </article>
  );
}
