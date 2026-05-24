import type { AgentTool } from "@minpeter/pss-runtime";
import { z } from "zod";
import { NON_DIRECTIONAL_TAP_DURATION } from "../supervisor";
import type { MgbaToolContext } from "./context";
import { buttonSchema, buttonsSchema } from "./schemas";

export function createTapTool({ client }: MgbaToolContext): AgentTool {
  return {
    description:
      "버튼 하나를 짧게 눌렀다 뗍니다. Supervisor가 A/B/Start/Select 같은 비방향 입력은 duration 6으로, 방향 입력은 안전한 단일 이동 duration 12로 실행합니다.",
    inputSchema: z.object({ button: buttonSchema }),
    execute: async ({ button }, { abortSignal }) => {
      await client.tap(button, abortSignal);
      return {
        duration: NON_DIRECTIONAL_TAP_DURATION,
        ok: true,
        tapped: button,
      };
    },
  } satisfies AgentTool;
}

export function createTapManyTool({ client }: MgbaToolContext): AgentTool {
  return {
    description:
      "여러 버튼을 동시에 짧게 눌렀다 뗍니다. 조합 입력이 필요할 때만 사용하세요. 일반 이동은 단일 방향 mgba_hold를 사용하세요.",
    inputSchema: z.object({ buttons: buttonsSchema }),
    execute: async ({ buttons }, { abortSignal }) => {
      await client.tapMany(buttons, abortSignal);
      return {
        duration: NON_DIRECTIONAL_TAP_DURATION,
        ok: true,
        tapped: buttons,
      };
    },
  } satisfies AgentTool;
}
