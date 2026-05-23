import type { AgentTool } from "@minpeter/pss-runtime";
import { z } from "zod";
import type { MgbaToolContext } from "./context";
import { buttonSchema, buttonsSchema } from "./schemas";

export function createTapTool({ client }: MgbaToolContext): AgentTool {
  return {
    description:
      "버튼 하나를 짧게 눌렀다 뗍니다. 메뉴 선택, 대화 넘김, 한 칸 이동 등에 사용합니다.",
    inputSchema: z.object({ button: buttonSchema }),
    execute: async ({ button }, { abortSignal }) => {
      await client.tap(button, abortSignal);
      return { ok: true, tapped: button };
    },
  } satisfies AgentTool;
}

export function createTapManyTool({ client }: MgbaToolContext): AgentTool {
  return {
    description:
      "여러 버튼을 동시에 짧게 눌렀다 뗍니다. 조합 입력이 필요할 때 사용합니다.",
    inputSchema: z.object({ buttons: buttonsSchema }),
    execute: async ({ buttons }, { abortSignal }) => {
      await client.tapMany(buttons, abortSignal);
      return { ok: true, tapped: buttons };
    },
  } satisfies AgentTool;
}
