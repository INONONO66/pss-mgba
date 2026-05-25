import type { LlmConversation, ContentPart } from "../api/types";

export interface ReasoningResult { thinking: string | null; rationale?: string; hasExplicitThinking: boolean; rawThinkTag: string | null; source: "think" | "preamble" | "rationale" | "none"; }
export interface ChipResult { chips: Array<{ label: string; type: "mode" | "rule" | "hint" }>; systemText: string; userText: string; }

export function messageText(message: { content: string | ContentPart[] }): string {
  if (typeof message.content === "string") return message.content;
  return (message.content ?? []).map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "image_url") return `[이미지 입력 생략${part.image_url?.detail ? ` detail=${part.image_url.detail}` : ""}]`;
    return "";
  }).filter(Boolean).join("\n");
}

export function extractReasoning(conversation: LlmConversation): ReasoningResult {
  const raw = conversation.responseContent ?? "";
  const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/i);
  const thinkContent = thinkMatch?.[1]?.trim() ?? null;
  if (thinkContent) return { thinking: thinkContent, rationale: conversation.parsedDecision?.rationale, hasExplicitThinking: true, rawThinkTag: thinkContent, source: "think" };
  const jsonStart = raw.indexOf("{");
  const preamble = jsonStart > 0 ? raw.slice(0, jsonStart).trim() : "";
  if (preamble.length > 10) return { thinking: preamble, rationale: conversation.parsedDecision?.rationale, hasExplicitThinking: true, rawThinkTag: null, source: "preamble" };
  const rationale = conversation.parsedDecision?.rationale;
  return { thinking: rationale ?? null, rationale, hasExplicitThinking: Boolean(rationale), rawThinkTag: null, source: rationale ? "rationale" : "none" };
}

export function extractSystemChips(conversation: LlmConversation): ChipResult {
  const systemText = (conversation.messages ?? []).filter((m) => m.role === "system").map(messageText).join("\n\n");
  const userText = (conversation.messages ?? []).filter((m) => m.role === "user").map(messageText).join("\n\n");
  const chips: ChipResult["chips"] = [{ label: conversation.mode ?? conversation.harnessMode ?? "unknown", type: "mode" }];
  const add = (needle: string | RegExp, label: string) => { if (typeof needle === "string" ? systemText.includes(needle) : needle.test(systemText)) chips.push({ label, type: "rule" }); };
  add(/World Rules|월드 규칙/i, "월드 규칙");
  add(/Progression/i, "진행 모델");
  add(/NPC Rules|NPC/i, "NPC 규칙");
  add(/Stuck Patterns|막힘/i, "막힘 패턴");
  add("navigate", "이동"); add("interact", "상호작용"); add(/battle/i, "전투"); add(/dialog/i, "대화");
  if (userText.includes("[ADVISER HINT]")) chips.push({ label: "조언자 힌트", type: "hint" });
  return { chips, systemText, userText };
}
