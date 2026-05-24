import type { AgentTool } from "@minpeter/pss-runtime";
import { z } from "zod";
import { MGBA_BUTTONS, type MgbaButton } from "../mgba-http";
import type { MgbaToolContext } from "./context";
import { buttonSchema } from "./schemas";

export function createReleaseTool({ client }: MgbaToolContext): AgentTool {
  return {
    description:
      "눌린 상태로 남아 있는 버튼을 해제합니다. button을 생략하면 모든 GBA 버튼을 해제합니다.",
    inputSchema: z.object({ button: buttonSchema.optional() }),
    execute: async ({ button }, { abortSignal }) => {
      const released: readonly MgbaButton[] = button ? [button] : MGBA_BUTTONS;
      if (button) {
        await client.clear(button, abortSignal);
      } else {
        await client.clearMany(MGBA_BUTTONS, abortSignal);
      }
      return { ok: true, released };
    },
  } satisfies AgentTool;
}
