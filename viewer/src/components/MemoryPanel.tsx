import type { AgentMemoryResponse } from "../api/types";

const SECTION_LABELS: Record<string, string> = { objectives: "목표", journal: "일지", notes: "노트", strategy: "전략" };
const SECTION_COLORS: Record<string, string> = { objectives: "var(--green)", journal: "var(--amber)", notes: "var(--cyan)", strategy: "var(--purple)" };

export default function MemoryPanel({ payload }: { payload: AgentMemoryResponse | null }) {
  if (!payload) { return <div className="empty">에이전트 메모리 로딩 중...</div>; }
  const sections = payload.sections;
  const sectionNames = ["objectives", "journal", "notes", "strategy"] as const;
  const total = sectionNames.reduce((sum, name) => sum + (sections[name]?.length ?? 0), 0);
  return (
    <div className="state-body scroll">
      <div className="kv" style={{ marginBottom: 10 }}>
        <b>메모리 상태</b>
        <span>{total}개 항목 · 최종 갱신 {payload.updatedAt ?? "없음"}</span>
      </div>
      {sectionNames.map((name) => {
        const entries = sections[name] ?? [];
        return (
          <div key={name} style={{ marginBottom: 12 }}>
            <div className="label" style={{ color: SECTION_COLORS[name], marginBottom: 6 }}>{SECTION_LABELS[name]} ({entries.length})</div>
            {entries.length === 0
              ? <div className="muted" style={{ fontSize: 11, padding: "4px 8px" }}>비어 있음</div>
              : entries.map((entry) => (
                <div key={entry.id} className="kv" style={{ marginBottom: 4, borderLeft: `3px solid ${SECTION_COLORS[name]}` }}>
                  <b>{entry.id} · {new Date(entry.createdAt).toLocaleTimeString()}</b>
                  <span>{entry.content}</span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
