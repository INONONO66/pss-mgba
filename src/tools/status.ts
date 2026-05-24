import type { AgentTool } from "@minpeter/pss-runtime";
import { z } from "zod";
import type { MgbaToolContext } from "./context";

export function createStatusTool({ client }: MgbaToolContext): AgentTool {
  return {
    description:
      "현재 mGBA 상태를 읽습니다. 활성 버튼, 현재 프레임, 게임 코드/타이틀을 반환합니다.",
    inputSchema: z.object({}),
    execute: async (_input, { abortSignal }) => client.status(abortSignal),
  } satisfies AgentTool;
}
