import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@minpeter/pss-runtime";
import { z } from "zod";
import { readOptimizedGameBoyScreenshotBase64 } from "../screenshot-image";
import type { MgbaToolContext } from "./context";

interface ScreenshotOutput {
  data: string;
  mediaType: "image/png";
  path: string;
}

export function createScreenshotTool({ client }: MgbaToolContext): AgentTool {
  return {
    description:
      "현재 mGBA 화면을 PNG로 캡처하고, 다음 모델 step에서 이미지를 직접 볼 수 있게 반환합니다.",
    inputSchema: z.object({}),
    execute: async (_input, { abortSignal }): Promise<ScreenshotOutput> => {
      const screenshotPath = await createScreenshotPath();
      await client.screenshot(screenshotPath, abortSignal);
      const data = await readOptimizedGameBoyScreenshotBase64(screenshotPath);

      return {
        data,
        mediaType: "image/png",
        path: screenshotPath,
      };
    },
    toModelOutput: ({ output }) => {
      const screenshot = output as ScreenshotOutput;

      return {
        type: "content",
        value: [
          {
            type: "text",
            text: `Current mGBA screenshot saved at ${screenshot.path}.`,
          },
          {
            type: "file",
            mediaType: screenshot.mediaType,
            data: { type: "data", data: screenshot.data },
            filename: "mgba-screenshot.png",
          },
        ],
      };
    },
  } satisfies AgentTool;
}

export async function createScreenshotPath(): Promise<string> {
  const directory = join(tmpdir(), "pss-mgba-screenshots");
  await mkdir(directory, { recursive: true });
  return join(
    directory,
    `mgba-${Date.now()}-${process.pid}-${randomUUID()}.png`
  );
}
