import type { AgentTool } from "@minpeter/pss-runtime";
import { z } from "zod";
import type { MgbaToolContext } from "./context";

export function createLoadRomTool({
  client,
  romPath,
}: MgbaToolContext): AgentTool {
  return {
    description:
      "환경변수 MGBA_ROM_PATH의 ROM 파일을 mGBA에 로드합니다. 새 게임을 시작하기 전 호출하세요.",
    inputSchema: z.object({}),
    execute: async (_input, { abortSignal }) => {
      const response = await client.loadFile(romPath, abortSignal);
      return {
        ok: normalizeBooleanResponse(response),
        path: romPath,
        response,
      };
    },
  } satisfies AgentTool;
}

function normalizeBooleanResponse(response: string): boolean {
  return response.trim().toLowerCase() === "true" || response.trim() === "";
}
