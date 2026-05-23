import { readFile } from "node:fs/promises";
import type { AgentInput, UserMessageContentPart } from "@minpeter/pss-runtime";
import type { MgbaHttpClient, MgbaStatus } from "./mgba-http";
import { createScreenshotPath } from "./tools/screenshot";

export interface MgbaObservation {
  screenshot: {
    data: string;
    mediaType: "image/png";
    path: string;
  };
  status: MgbaStatus;
}

export async function captureMgbaObservation(
  client: MgbaHttpClient,
  signal?: AbortSignal
): Promise<MgbaObservation> {
  const screenshotPath = await createScreenshotPath();
  const [status] = await Promise.all([
    client.status(signal),
    client.screenshot(screenshotPath, signal),
  ]);
  const data = await readFile(screenshotPath, "base64");

  return {
    screenshot: {
      data,
      mediaType: "image/png",
      path: screenshotPath,
    },
    status,
  };
}

export function createObservedInput({
  observation,
  text,
}: {
  observation: MgbaObservation;
  text: string;
}): AgentInput {
  return [
    {
      text: `${text}\n\nCurrent mGBA status:\n${formatStatus(observation.status)}\n\nCurrent screenshot: ${observation.screenshot.path}`,
      type: "text",
    },
    {
      image: `data:${observation.screenshot.mediaType};base64,${observation.screenshot.data}`,
      mediaType: observation.screenshot.mediaType,
      type: "image",
    },
  ] satisfies UserMessageContentPart[];
}

export function formatStatus(status: MgbaStatus): string {
  const activeButtons = status.activeButtons.join(", ") || "none";
  return [
    `frame: ${status.frame ?? "unknown"}`,
    `game: ${[status.gameTitle, status.gameCode].filter(Boolean).join(" ") || "unknown"}`,
    `active buttons: ${activeButtons}`,
  ].join("\n");
}
