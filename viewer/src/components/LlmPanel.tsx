import { Fragment, useEffect, useMemo, useState } from "react";
import type { LlmConversation, LlmConversationsResponse } from "../api/types";
import { extractReasoning, extractSystemChips, messageText } from "../lib/reasoning";
import { currentMapAscii, parsePromptSections } from "../lib/sections";
import MapGrid from "./MapGrid";
import Timeline from "./Timeline";
import { json, summarizeAction, value } from "./shared";

type LlmTab = "overview" | "system" | "state" | "user" | "raw";

function decisionArgs(conversation: LlmConversation) {
  const command = conversation.parsedDecision?.command;
  if (!command) { return []; }
  return Object.entries(command).filter(([key]) => key !== "type").map(([key, entry]) => `${key}=${Array.isArray(entry) ? `[${entry.join(",")}]` : value(entry)}`);
}

function PromptSections({ conversation }: { conversation: LlmConversation }) {
  const user = conversation.messages.filter((message) => message.role === "user").map(messageText).join("\n\n");
  const sections = parsePromptSections(user);
  return <>{sections.map((section) => <section className="prompt-section" key={section.title}><div className="prompt-section-title">{section.label}</div><div className="prompt-section-body">{section.title === "CURRENT MAP" && currentMapAscii(section.content) ? <MapGrid ascii={currentMapAscii(section.content)} /> : section.title === "HISTORY" ? section.content.split("\n").filter(Boolean).map((entry) => <div className={`history-entry ${entry.toLowerCase().includes("failed") ? "history-failed" : "history-success"}`} key={entry}>{entry}</div>) : <pre className="mono-block">{section.content}</pre>}</div></section>)}</>;
}

function Overview({ conversation }: { conversation: LlmConversation }) {
  const decision = conversation.parsedDecision;
  const reasoning = extractReasoning(conversation);
  const chips = extractSystemChips(conversation);
  const sections = parsePromptSections(chips.userText);
  const confidence = decision?.confidence === undefined ? null : Math.max(0, Math.min(100, Math.round(decision.confidence * 100)));
  const commandType = decision?.command?.type ?? decision?.action?.type;
  return (
    <>
      <div className="decision-card decision-head"><div className="decision-head-group"><span className="chip">MODEL</span><span className="value">CALL #{value(conversation.call)}</span><span className="chip">{value(conversation.mode ?? conversation.harnessMode).toUpperCase()}</span></div><span className="action-badge"><span className="btn">{commandType ?? "대기"}</span>{summarizeAction({ parsedDecision: decision })}</span></div>
      <Timeline steps={[
        { title: "본 것", tone: "seeing", children: <><div className="rule-chips">{chips.chips.map((chip) => <span className={`rule-chip ${chip.type}`} key={`${chip.type}-${chip.label}`}>{chip.label}</span>)}</div>{chips.systemText ? <details><summary>시스템 프롬프트 보기</summary><div className="collapsed-content">{chips.systemText}</div></details> : null}<div className="state-summary">{sections.map((section) => <div className="state-summary-item" key={section.title}><b>{section.label}</b>{section.content.split("\n").slice(0, 3).join("\n")}</div>)}</div></> },
        { title: "생각한 것", tone: "thinking", children: <>{reasoning.thinking ? <div className="reasoning-block">{reasoning.thinking}</div> : <div className="reasoning-block muted">명시적 추론 없음</div>}{reasoning.rawThinkTag ? <details><summary>모델 내부 추론 원문 보기</summary><div className="collapsed-content">{reasoning.rawThinkTag}</div></details> : null}</> },
        { title: "결정한 것", tone: "deciding", children: decision ? <><div><span className="action-badge"><span className="btn">{commandType}</span>{summarizeAction({ parsedDecision: decision })}</span></div>{decisionArgs(conversation).length > 0 ? <div className="rule-chips">{decisionArgs(conversation).map((entry) => <span className="rule-chip rule" key={entry}>{entry}</span>)}</div> : null}{decision.rationale ? <div className="rationale-block">{decision.rationale}</div> : null}{confidence !== null ? <div><span className="label">확신도</span><div className="confidence-bar"><div className="confidence-fill" style={{ width: `${confidence}%` }} /></div><div className="value">{confidence}%</div></div> : null}{(decision.observedStateCitations ?? []).length > 0 ? <div><span className="label">근거 출처</span><div className="citations-row">{decision.observedStateCitations?.map((citation) => <span className="citation-chip" key={citation}>{citation}</span>)}</div></div> : null}</> : <div className="value muted">판단 대기 중</div> }
      ]} />
    </>
  );
}

function RawConversation({ conversation }: { conversation: LlmConversation }) {
  return <pre className="pretty-text">{["[원본 응답]", conversation.responseContent ?? "원본 응답 없음", "", "[오류]", conversation.error ? json(conversation.error) : "없음", "", "[전체 추적]", json(conversation)].join("\n")}</pre>;
}

export default function LlmPanel({ payload }: { payload: LlmConversationsResponse | null }) {
  const [selectedFile, setSelectedFile] = useState<string | undefined>();
  const [tab, setTab] = useState<LlmTab>("overview");
  const conversations = payload?.conversations ?? [];
  useEffect(() => {
    if (conversations.length > 0 && (!selectedFile || !conversations.some((entry) => entry.fileName === selectedFile))) { setSelectedFile(conversations[0].fileName); }
  }, [conversations, selectedFile]);
  const selected = useMemo(() => conversations.find((entry) => entry.fileName === selectedFile) ?? conversations[0], [conversations, selectedFile]);
  const system = selected?.messages.filter((message) => message.role === "system").map(messageText).join("\n\n") ?? "시스템 프롬프트 없음";
  return (
    <article className="panel llm-panel">
      <div className="panel-header"><h2>LLM 프롬프트 + 판단</h2><p>{payload ? `${payload.count} 저장됨 · 최신 ${conversations[0]?.fileName ?? "없음"}` : "대기 중..."}</p></div>
      <div className="llm-layout"><div className="llm-rail">{conversations.map((conversation) => <button className={`history-button ${conversation.fileName === selected?.fileName ? "active" : ""}`} key={conversation.fileName ?? conversation.call} onClick={() => setSelectedFile(conversation.fileName)}>{conversation.fileName}{"\n"}호출 {value(conversation.call)} · {summarizeAction(conversation)}{"\n"}{conversation.error ? "오류" : conversation.parsedDecision ? "판단 완료" : "대기 중"}</button>)}</div>
        <div className="panel" style={{ border: 0, boxShadow: "none", background: "transparent" }}><div className="llm-tabs">{[["overview", "판단"], ["system", "시스템"], ["state", "상태"], ["user", "주입"], ["raw", "원본"]].map(([id, label]) => <button className={`tab ${tab === id ? "active" : ""}`} key={id} onClick={() => setTab(id as LlmTab)}>{label}</button>)}</div><div className="llm-detail scroll">{selected ? <Fragment>{tab === "overview" ? <Overview conversation={selected} /> : null}{tab === "system" ? <pre className="pretty-text">{system}</pre> : null}{tab === "state" || tab === "user" ? <PromptSections conversation={selected} /> : null}{tab === "raw" ? <RawConversation conversation={selected} /> : null}</Fragment> : <div className="empty">LLM 대화 기록이 없습니다.</div>}</div></div>
      </div>
    </article>
  );
}
