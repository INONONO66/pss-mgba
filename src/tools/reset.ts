import type { AgentTool } from "@minpeter/pss-runtime";
import { z } from "zod";
import type { MgbaToolContext } from "./context";

export function createResetTool({ client }: MgbaToolContext): AgentTool {
  return {
    description:
      "현재 mGBA 코어를 리셋합니다. 게임 진행 상태가 초기화될 수 있으니 필요한 경우에만 사용합니다.",
    inputSchema: z.object({}),
    execute: async (_input, { abortSignal }) => {
      await client.reset(abortSignal);
      return { ok: true };
    },
  } satisfies AgentTool;
}
