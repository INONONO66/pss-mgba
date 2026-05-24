import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRunPaths } from "../../src/evidence/RunPaths.js";
import { startDevViewerServer } from "../../src/viewer/DevViewerServer.js";

interface VisionImagesResponse {
  readonly runId: string;
  readonly limit: number;
  readonly count: number;
  readonly images: Array<{ readonly fileName: string }>;
}

interface LlmConversationsResponse {
  readonly runId: string;
  readonly count: number;
  readonly conversations: Array<{ readonly fileName: string; readonly model?: string; readonly responseContent?: string }>;
}

interface EventsResponse {
  readonly runId: string;
  readonly limit: number;
  readonly count: number;
  readonly events: Array<{ readonly type: string; readonly payload?: { readonly supervisor?: { readonly state?: string; readonly activeGoal?: { readonly title?: string } } } }>;
}

describe("DevViewerServer", () => {
  it("serves the live frame and latest LLM context images for one active run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dev-viewer-"));
    const evidenceDir = path.join(root, "runs");
    const paths = buildRunPaths(evidenceDir, "viewer-run");
    await mkdir(paths.visionDir, { recursive: true });
    await mkdir(paths.llmConversationsDir, { recursive: true });
    await writeFile(path.join(paths.visionDir, "000001-frame-11.jpeg"), Buffer.from([1, 2, 3]));
    await writeFile(path.join(paths.visionDir, "000002-frame-22.png"), Buffer.from([4, 5, 6]));
    await writeFile(path.join(paths.visionDir, "000003-frame-33.webp"), Buffer.from([7, 8, 9]));
    await writeFile(paths.eventsFile, [
      JSON.stringify({ type: "run_started", timestamp: "2026-05-24T00:00:00.000Z", payload: { config: { mode: "test" } } }),
      JSON.stringify({
        type: "decision",
        sequence: 1,
        timestamp: "2026-05-24T00:00:01.000Z",
        payload: {
          supervisor: {
            state: "progressing",
            activeGoal: { title: "Obtain the first party Pokemon", kind: "advance-story" },
            guidance: ["Current focus: Obtain the first party Pokemon."]
          }
        }
      })
    ].join("\n"));
    await writeFile(path.join(paths.llmConversationsDir, "000001.json"), JSON.stringify({
      model: "grok-test",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Full game state summary" },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,[omitted]", detail: "low" } }
        ]
      }],
      responseContent: "{\"action\":{\"type\":\"press\",\"button\":\"A\"}}"
    }));
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const screenshots: string[] = [];
    const viewer = await startDevViewerServer({
      evidenceDir,
      runId: "viewer-run",
      visionImageLimit: 2,
      port: 0,
      tempDir: path.join(root, "tmp"),
      client: {
        async screenshot(targetPath) {
          if (targetPath === undefined) {
            throw new Error("target path required");
          }
          screenshots.push(targetPath);
          await writeFile(targetPath, pngBytes);
          return targetPath;
        }
      }
    });

    try {
      const html = await fetchText(`${viewer.url}/`);
      expect(html).toContain("Main game screen");
      expect(html).toContain("LLM context images");
      expect(html).toContain("LLM history");
      expect(html).toContain("LLM context + decision");
      expect(html).toContain("Loading latest 2 processed input(s)");
      expect(html).toContain("/api/live-frame");
      expect(html).toContain("/api/vision-images");
      expect(html).toContain("/api/llm-conversations");
      expect(html).toContain("/api/events");
      expect(html).toContain(paths.llmConversationsDir);
      expect(html).toContain("setInterval(tick, 1000)");
      expect(html).toContain(".layout");
      expect(html).toContain(".image-cell");
      expect(html).toContain(".vision-wall");
      expect(html).toContain("#live-frame");
      expect(html).toContain(".vision-grid");
      expect(html).toContain(".vision-cell");
      expect(html).toContain(".conversation-panel");
      expect(html).toContain(".history-rail");
      expect(html).toContain(".history-button");
      expect(html).toContain(".event-panel");
      expect(html).toContain("id=\"event-list\"");
      expect(html).toContain("sequence (");
      expect(html).toContain("childActions.join(' → ')");
      expect(html).toContain("aspect-ratio: 1 / 1");
      expect(html).toContain("grid-template-columns: minmax(320px, 2fr) minmax(220px, 1fr)");
      expect(html).toContain("repeat(3, minmax(0, 1fr))");
      expect(html).not.toContain("base64");
      expect(html).not.toContain("data:image");

      const frameResponse = await fetch(`${viewer.url}/api/live-frame`);
      expect(frameResponse.headers.get("content-type")).toContain("image/png");
      expect(Buffer.from(await frameResponse.arrayBuffer())).toEqual(pngBytes);
      expect(screenshots).toHaveLength(1);

      const metadata = await fetchJson(`${viewer.url}/api/vision-images`);
      expect(metadata).toMatchObject({ runId: "viewer-run", limit: 2, count: 2 });
      expect(metadata.images.map((image) => image.fileName)).toEqual(["000002-frame-22.png", "000003-frame-33.webp"]);
      expect(JSON.stringify(metadata)).not.toContain("base64");

      const conversations = await fetchLlmJson(`${viewer.url}/api/llm-conversations`);
      expect(conversations).toMatchObject({ runId: "viewer-run", count: 1 });
      expect(conversations.conversations[0]).toMatchObject({
        fileName: "000001.json",
        model: "grok-test",
        responseContent: expect.stringContaining("press")
      });
      expect(JSON.stringify(conversations)).not.toContain("data:image");
      expect(JSON.stringify(conversations)).not.toContain("base64");
      expect(JSON.stringify(conversations)).toContain("[image input omitted from dashboard log]");

      const events = await fetchEventJson(`${viewer.url}/api/events?limit=2`);
      expect(events).toMatchObject({ runId: "viewer-run", limit: 2, count: 2 });
      expect(events.events[0]).toMatchObject({
        type: "decision",
        payload: {
          supervisor: {
            state: "progressing",
            activeGoal: { title: "Obtain the first party Pokemon" }
          }
        }
      });

      const imageResponse = await fetch(`${viewer.url}/vision/000001-frame-11.jpeg`);
      expect(imageResponse.headers.get("content-type")).toContain("image/jpeg");
      expect(Buffer.from(await imageResponse.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));

      expect((await fetch(`${viewer.url}/vision/000999-frame-99.jpeg`)).status).toBe(404);
      expect((await fetch(`${viewer.url}/vision/..%2Fconfig.json`)).status).toBe(404);
    } finally {
      await viewer.close();
    }
  });

  it("ignores symlinked LLM conversation artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dev-viewer-symlink-"));
    const evidenceDir = path.join(root, "runs");
    const paths = buildRunPaths(evidenceDir, "viewer-run");
    await mkdir(paths.llmConversationsDir, { recursive: true });
    await writeFile(path.join(paths.llmConversationsDir, "000001.json"), JSON.stringify({ model: "real" }));

    const outsideFile = path.join(root, "outside.json");
    await writeFile(outsideFile, JSON.stringify({ model: "symlink-leak" }));
    await symlink(outsideFile, path.join(paths.llmConversationsDir, "000002.json"));

    const viewer = await startDevViewerServer({
      evidenceDir,
      runId: "viewer-run",
      port: 0,
      tempDir: path.join(root, "tmp"),
      client: {
        async screenshot(targetPath) {
          if (targetPath === undefined) throw new Error("target path required");
          await writeFile(targetPath, Buffer.from([1]));
          return targetPath;
        }
      }
    });

    try {
      const conversations = await fetchLlmJson(`${viewer.url}/api/llm-conversations`);
      expect(conversations).toMatchObject({ count: 1 });
      expect(conversations.conversations.map((conversation) => conversation.model)).toEqual(["real"]);
      expect(JSON.stringify(conversations)).not.toContain("symlink-leak");
    } finally {
      await viewer.close();
    }
  });
});

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return response.text();
}

async function fetchJson(url: string): Promise<VisionImagesResponse> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json() as VisionImagesResponse;
}

async function fetchLlmJson(url: string): Promise<LlmConversationsResponse> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json() as LlmConversationsResponse;
}

async function fetchEventJson(url: string): Promise<EventsResponse> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json() as EventsResponse;
}
