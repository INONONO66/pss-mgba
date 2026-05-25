export interface Section { title: string; content: string; label: string; }

const SECTION_RE = /^\[(PROGRESS|LAST RESULT|ADVISER HINT|STATE:[^\]]+|MAP GRAPH|CURRENT MAP|HISTORY)\]/gm;

export function sectionLabel(title: string): string {
  if (title === "PROGRESS") return "진행";
  if (title === "LAST RESULT") return "직전 결과";
  if (title.startsWith("STATE:")) return "현재 상태";
  if (title === "MAP GRAPH") return "맵 연결";
  if (title === "CURRENT MAP") return "현재 맵";
  if (title === "HISTORY") return "최근 행동";
  if (title === "ADVISER HINT") return "조언자 힌트";
  return title;
}

export function parsePromptSections(text: string): Section[] {
  if (!text) return [];
  SECTION_RE.lastIndex = 0;
  const marks: Array<{ index: number; title: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = SECTION_RE.exec(text)) !== null) marks.push({ index: match.index, title: match[1] });
  if (marks.length === 0) return [{ title: "프롬프트", label: "프롬프트", content: text }];
  return marks.map((mark, index) => {
    const end = marks[index + 1]?.index ?? text.length;
    const block = text.slice(mark.index, end).trim();
    return { title: mark.title, label: sectionLabel(mark.title), content: block.slice(block.indexOf("]") + 1).trim() };
  });
}

export function currentMapAscii(content: string): string | null {
  const beforeLegend = content.split(/\n\s*Legend:/)[0] ?? content;
  const rows = beforeLegend.split("\n").filter((line) => /^\s*\d+\s+[.#"?@NW]+\s*$/.test(line));
  return rows.length > 0 ? rows.join("\n") : null;
}
