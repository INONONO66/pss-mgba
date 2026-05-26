import { useEffect, useRef, useState } from "react";
import type { ConsoleEntry } from "../api/types";

type LogLevel = "all" | "info" | "warn" | "error" | "debug";

const LEVEL_CLASS: Record<string, string> = {
  info: "v2-console-info",
  warn: "v2-console-warn",
  error: "v2-console-error",
  debug: "v2-console-debug",
};

const LEVEL_BADGES: Record<string, string> = {
  info: "INF",
  warn: "WRN",
  error: "ERR",
  debug: "DBG",
};

export default function ConsolePanel({ entries }: { entries: ConsoleEntry[] }) {
  const [filter, setFilter] = useState<LogLevel>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = filter === "all" ? entries : entries.filter((e) => e.level === filter);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  return (
    <div className="v2-console">
      <div className="v2-console-toolbar">
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "info", "warn", "error", "debug"] as LogLevel[]).map((level) => (
            <button type="button" key={level} className={`tab ${filter === level ? "active" : ""}`} onClick={() => setFilter(level)}>
              {level.toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="muted" style={{ font: "10px/1 var(--mono)" }}>{filtered.length} 줄</span>
          <button type="button" className={`tab ${autoScroll ? "active" : ""}`} onClick={() => setAutoScroll((prev) => !prev)}>
            자동 스크롤
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="v2-console-body">
        {filtered.length === 0 ? (
          <div className="empty compact">
            {entries.length === 0 ? "로그가 아직 없습니다. 에이전트가 실행되면 여기에 표시됩니다." : "선택한 레벨의 로그가 없습니다."}
          </div>
        ) : (
          filtered.map((entry, i) => (
            <div key={`${entry.at}-${i}`} className="v2-console-line">
              <span className="v2-console-ts">{entry.at.slice(11, 23)}</span>
              <span className={`v2-console-lvl ${LEVEL_CLASS[entry.level] ?? ""}`}>{LEVEL_BADGES[entry.level] ?? entry.level}</span>
              <span className={LEVEL_CLASS[entry.level] ?? ""}>{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
