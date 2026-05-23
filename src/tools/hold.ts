import type { AgentTool } from "@minpeter/pss-runtime";
import { z } from "zod";
import type { MgbaToolContext } from "./context";
import { buttonSchema, buttonsSchema, durationSchema } from "./schemas";

export function createHoldTool({ client }: MgbaToolContext): AgentTool {
  return {
    description:
      "버튼 하나를 지정한 프레임 동안 유지합니다. 연속 이동에는 방향키와 duration을 사용하세요.",
    inputSchema: z.object({ button: buttonSchema, duration: durationSchema }),
    execute: async ({ button, duration }, { abortSignal }) => {
      await client.hold(button, duration, abortSignal);
      return { ok: true, held: button, duration };
    },
  } satisfies AgentTool;
}

export function createHoldManyTool({ client }: MgbaToolContext): AgentTool {
  return {
    description: "여러 버튼을 지정한 프레임 동안 동시에 유지합니다.",
    inputSchema: z.object({ buttons: buttonsSchema, duration: durationSchema }),
    execute: async ({ buttons, duration }, { abortSignal }) => {
      await client.holdMany(buttons, duration, abortSignal);
      return { ok: true, held: buttons, duration };
    },
  } satisfies AgentTool;
}
