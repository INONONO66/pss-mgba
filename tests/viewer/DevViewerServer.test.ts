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
  readonly events: Array<{ readonly type: string; readonly payload?: Record<string, unknown> }>;
}

interface GameStateResponse {
  readonly runId: string;
  readonly limit: number;
  readonly count: number;
  readonly latest?: { readonly fileName: string; readonly state?: { readonly state?: Record<string, unknown> } };
}

interface ScreenshotsResponse {
  readonly runId: string;
  readonly limit: number;
  readonly count: number;
  readonly screenshots: Array<{ readonly fileName: string; readonly url: string; readonly step: number | null }>;
}

interface RunSummaryResponse {
  readonly runId: string;
  readonly status: string;
  readonly totalSteps?: number;
  readonly finalFrame?: number;
  readonly counts?: { readonly decisions?: number; readonly errors?: number };
  readonly detectorStatus?: { readonly status?: string };
  readonly lastAction?: { readonly confidence?: number };
}

describe("DevViewerServer", () => {
  it("serves the live frame and latest LLM context images for one active run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dev-viewer-"));
    const evidenceDir = path.join(root, "runs");
    const paths = buildRunPaths(evidenceDir, "viewer-run");
    await mkdir(paths.visionDir, { recursive: true });
    await mkdir(paths.llmConversationsDir, { recursive: true });
    await mkdir(paths.statesDir, { recursive: true });
    await mkdir(paths.rawScreenshotsDir, { recursive: true });
    await writeFile(path.join(paths.visionDir, "000001-frame-11.jpeg"), Buffer.from([1, 2, 3]));
    await writeFile(path.join(paths.visionDir, "000002-frame-22.png"), Buffer.from([4, 5, 6]));
    await writeFile(path.join(paths.visionDir, "000003-frame-33.webp"), Buffer.from([7, 8, 9]));
    await writeFile(path.join(paths.rawScreenshotsDir, "000001.png"), Buffer.from([9, 8, 7]));
    await writeFile(path.join(paths.rawScreenshotsDir, "000002.png"), Buffer.from([6, 5, 4]));
    await writeFile(path.join(paths.statesDir, "000001.json"), JSON.stringify({ step: 1, frame: 100, state: { wCurMap: 38, wYCoord: 3, wXCoord: 3 }, stateHash: "abc" }));
    await writeFile(paths.eventsFile, [
      JSON.stringify({ type: "run_started", timestamp: "2026-05-24T00:00:00.000Z", payload: { config: { mode: "test" } } }),
      JSON.stringify({
        type: "decision",
        sequence: 1,
        timestamp: "2026-05-24T00:00:01.000Z",
        payload: {
          step: 1,
          frame: 100,
          decision: {
            action: { type: "press", button: "A", frames: 5 },
            confidence: 0.8,
            rationale: "Advance current dialog."
          }
        }
      })
    ].join("\n"));
    await writeFile(paths.summaryFile, JSON.stringify({
      runId: "viewer-run",
      status: "failed_timeout",
      startedAt: "2026-05-24T00:00:00.000Z",
      finishedAt: "2026-05-24T00:00:02.000Z",
      counts: { states: 1, decisions: 1, actions: 1, screenshots: 1, llmConversations: 1, errors: 0, events: 7 },
      result: {
        status: "failed_timeout",
        totalSteps: 12,
        finalFrame: 345,
        detector: { status: "running", progressStep: 10, lastProgressStep: 8 },
        last20Actions: [{
          step: 12,
          frame: 345,
          action: { type: "press", button: "A", frames: 5 },
          confidence: 0.8,
          rationale: "Advance current dialog."
        }]
      }
    }));
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
      expect(html).toContain("Live game screen");
      expect(html).toContain("Current state");
      expect(html).toContain("LLM prompt + decision");
      expect(html).toContain("Input context + run logs");
      expect(html).toContain("System</button>");
      expect(html).toContain("State</button>");
      expect(html).toContain("Injected</button>");
      expect(html).toContain("Raw</button>");
      expect(html).toContain("Raw logs</button>");
      expect(html).toContain("Loading latest 2 processed input(s)");
      expect(html).toContain("/api/live-frame");
      expect(html).toContain("/api/vision-images");
      expect(html).toContain("/api/llm-conversations");
      expect(html).toContain("/api/events");
      expect(html).toContain("/api/game-state");
      expect(html).toContain("/api/run-summary");
      expect(html).toContain("setInterval(tick, 1000)");
      expect(html).toContain(".shell");
      expect(html).toContain("height: 100svh");
      expect(html).toContain("repeat(auto-fit, minmax(");
      expect(html).toContain(".grid");
      expect(html).toContain(".screen-panel");
      expect(html).toContain("#live-frame");
      expect(html).toContain(".vision-grid");
      expect(html).toContain(".vision-cell");
      expect(html).toContain(".llm-panel");
      expect(html).toContain(".llm-rail");
      expect(html).toContain(".history-button");
      expect(html).toContain(".state-panel");
      expect(html).toContain(".context-panel");
      expect(html).toContain(".raw-log");
      expect(html).toContain(".injection-summary");
      expect(html).toContain(".topbar");
      expect(html).toContain('id=\"summary-status\"');
      expect(html).toContain('id=\"summary-player\"');
      expect(html).toContain('id=\"summary-map\"');
      expect(html).toContain('id=\"state-pretty\"');
      expect(html).toContain('id=\"event-list\"');
      expect(html).toContain('id=\"raw-log\"');
      expect(html).toContain('data-context-tab=\"raw\"');
      expect(html).toContain("extractStateContext(user)");
      expect(html).toContain("formatInjectedSummaryHtml(injectedState)");
      expect(html).toContain("formatConversationTab(latestConversation, selectedLlmTab)");
      expect(html).toContain("sequence (");
      expect(html).toContain("childActions.join(' → ')");
      expect(html).toContain("aspect-ratio: 1 / 1");
      expect(html).toContain("grid-template-columns: minmax(390px, 1.08fr) minmax(340px, 0.92fr) minmax(430px, 1.12fr)");
      expect(html).toContain("grid-column: 1 / span 2");
      expect(html).not.toContain("Screen history");
      expect(html).not.toContain(".history-panel");
      expect(html).not.toContain("screenshot-grid");
      expect(html).not.toContain("refreshScreenshotHistory");
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
          decision: {
            action: { type: "press", button: "A", frames: 5 }
          }
        }
      });

      const gameState = await fetchGameStateJson(`${viewer.url}/api/game-state?limit=5`);
      expect(gameState).toMatchObject({ runId: "viewer-run", limit: 5, count: 1 });
      expect(gameState.latest).toMatchObject({
        fileName: "000001.json",
        state: { wCurMap: 38, wYCoord: 3, wXCoord: 3 }
      });

      const rawScreenshots = await fetchScreenshotsJson(`${viewer.url}/api/screenshots?limit=12`);
      expect(rawScreenshots).toMatchObject({ runId: "viewer-run", limit: 12, count: 2 });
      expect(rawScreenshots.screenshots.map((screenshot) => screenshot.fileName)).toEqual(["000002.png", "000001.png"]);

      const summary = await fetchRunSummaryJson(`${viewer.url}/api/run-summary`);
      expect(summary).toMatchObject({
        runId: "viewer-run",
        status: "failed_timeout",
        totalSteps: 12,
        finalFrame: 345,
        counts: { decisions: 1, errors: 0 },
        detectorStatus: { status: "running" },
        lastAction: { confidence: 0.8 }
      });
      expect(JSON.stringify(summary)).not.toContain("last20Actions");
      expect(JSON.stringify(summary)).not.toContain("recentStateHashes");

      const imageResponse = await fetch(`${viewer.url}/vision/000001-frame-11.jpeg`);
      expect(imageResponse.headers.get("content-type")).toContain("image/jpeg");
      expect(Buffer.from(await imageResponse.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));

      const rawImageResponse = await fetch(`${viewer.url}/raw-screenshots/000001.png`);
      expect(rawImageResponse.headers.get("content-type")).toContain("image/png");
      expect(Buffer.from(await rawImageResponse.arrayBuffer())).toEqual(Buffer.from([9, 8, 7]));

      expect((await fetch(`${viewer.url}/vision/000999-frame-99.jpeg`)).status).toBe(404);
      expect((await fetch(`${viewer.url}/vision/..%2Fconfig.json`)).status).toBe(404);
      expect((await fetch(`${viewer.url}/raw-screenshots/..%2Fconfig.json`)).status).toBe(404);
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

async function fetchRunSummaryJson(url: string): Promise<RunSummaryResponse> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json() as RunSummaryResponse;
}

async function fetchGameStateJson(url: string): Promise<GameStateResponse> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json() as GameStateResponse;
}

async function fetchScreenshotsJson(url: string): Promise<ScreenshotsResponse> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json() as ScreenshotsResponse;
}
