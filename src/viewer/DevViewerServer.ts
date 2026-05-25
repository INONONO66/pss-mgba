import http, { type Server } from "node:http";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildRunPaths } from "../evidence/RunPaths.js";
import { listLatestVisionImages, isSafeVisionFileName, visionImageContentType } from "./visionImages.js";

export interface DevViewerClient {
  screenshot(path?: string): Promise<string>;
}

export interface DevViewerServerOptions {
  readonly client: DevViewerClient;
  readonly evidenceDir: string;
  readonly runId: string;
  readonly port?: number;
  readonly host?: string;
  readonly tempDir?: string;
  readonly visionImageLimit?: number;
}

export interface StartedDevViewerServer {
  readonly url: string;
  readonly server: Server;
  close(): Promise<void>;
}

export async function startDevViewerServer(options: DevViewerServerOptions): Promise<StartedDevViewerServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  const server = createDevViewerServer(options);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    url: `http://${host}:${actualPort}`,
    server,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

export function createDevViewerServer(options: DevViewerServerOptions): Server {
  const paths = buildRunPaths(options.evidenceDir, options.runId);
  const tempDir = options.tempDir ?? path.join(os.tmpdir(), "pss-mgba-dev-viewer", options.runId);
  const visionImageLimit = options.visionImageLimit ?? 3;

  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (requestUrl.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
        response.end(renderPage(options.runId, visionImageLimit, paths.llmConversationsDir));
        return;
      }

      if (requestUrl.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }

      if (requestUrl.pathname === "/api/live-frame") {
        await mkdir(tempDir, { recursive: true });
        const screenshotPath = path.join(tempDir, "live-frame.png");
        const savedPath = await options.client.screenshot(screenshotPath);
        const bytes = await readFile(savedPath);
        response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        response.end(bytes);
        return;
      }

      if (requestUrl.pathname === "/api/vision-images") {
        const images = await listLatestVisionImages({ evidenceDir: options.evidenceDir, runId: options.runId, limit: visionImageLimit });
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ runId: options.runId, limit: visionImageLimit, count: images.length, images }));
        return;
      }

      if (requestUrl.pathname === "/api/llm-conversations") {
        const limitParam = Number(requestUrl.searchParams.get("limit") ?? "10");
        const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(50, Math.trunc(limitParam))) : 10;
        const conversations = await listLatestLlmConversations(paths.llmConversationsDir, limit);
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ runId: options.runId, limit, count: conversations.length, conversations }));
        return;
      }

      if (requestUrl.pathname === "/api/game-state") {
        const limitParam = Number(requestUrl.searchParams.get("limit") ?? "5");
        const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(50, Math.trunc(limitParam))) : 5;
        const states = await listLatestGameStates(paths.statesDir, limit);
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ runId: options.runId, limit, count: states.length, latest: states[0], states }));
        return;
      }

      if (requestUrl.pathname === "/api/screenshots") {
        const limitParam = Number(requestUrl.searchParams.get("limit") ?? "12");
        const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, Math.trunc(limitParam))) : 12;
        const screenshots = await listLatestRawScreenshots(paths.rawScreenshotsDir, limit);
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ runId: options.runId, limit, count: screenshots.length, screenshots }));
        return;
      }

      if (requestUrl.pathname === "/api/events") {
        const limitParam = Number(requestUrl.searchParams.get("limit") ?? "20");
        const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, Math.trunc(limitParam))) : 20;
        const events = await listLatestEvents(paths.eventsFile, limit);
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ runId: options.runId, limit, count: events.length, events }));
        return;
      }

      if (requestUrl.pathname === "/api/run-summary") {
        const summary = await readRunSummary(paths.summaryFile, options.runId);
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify(summary));
        return;
      }

      if (requestUrl.pathname.startsWith("/vision/")) {
        const fileName = decodeURIComponent(requestUrl.pathname.slice("/vision/".length));
        const contentType = isSafeVisionFileName(fileName) ? visionImageContentType(fileName) : undefined;
        if (contentType === undefined) {
          response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
          response.end("vision image not found");
          return;
        }

        const filePath = path.resolve(path.join(paths.visionDir, fileName));
        const visionDir = path.resolve(paths.visionDir);
        if (!filePath.startsWith(`${visionDir}${path.sep}`)) {
          response.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" });
          response.end("invalid vision image path");
          return;
        }

        const bytes = await readVisionFile(filePath);
        if (bytes === undefined) {
          response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
          response.end("vision image not found");
          return;
        }
        response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
        response.end(bytes);
        return;
      }

      if (requestUrl.pathname.startsWith("/raw-screenshots/")) {
        const fileName = decodeURIComponent(requestUrl.pathname.slice("/raw-screenshots/".length));
        if (!isSafeRawScreenshotFileName(fileName)) {
          response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
          response.end("raw screenshot not found");
          return;
        }

        const filePath = path.resolve(path.join(paths.rawScreenshotsDir, fileName));
        const rawDir = path.resolve(paths.rawScreenshotsDir);
        if (!filePath.startsWith(`${rawDir}${path.sep}`)) {
          response.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" });
          response.end("invalid raw screenshot path");
          return;
        }

        const bytes = await readVisionFile(filePath);
        if (bytes === undefined) {
          response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
          response.end("raw screenshot not found");
          return;
        }
        response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        response.end(bytes);
        return;
      }

      response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
}

function renderPage(runId: string, _visionImageLimit: number, llmConversationsPath: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>포켓몬 하네스 대시보드</title>
  <style>
    :root {
      --bg: #070b08;
      --panel: rgba(13, 21, 15, 0.94);
      --panel-strong: rgba(20, 30, 19, 0.98);
      --panel-soft: rgba(7, 11, 8, 0.72);
      --line: rgba(196, 255, 166, 0.18);
      --line-strong: rgba(140, 255, 113, 0.38);
      --green: #8cff71;
      --amber: #ffc857;
      --red: #ff765c;
      --ink: #edf8d8;
      --muted: #91a487;
      --muted-2: #64725f;
      --shadow: 0 22px 70px rgba(0, 0, 0, 0.46);
      --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
      --ui: "Avenir Next", "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-height: 100%; margin: 0; }
    body {
      min-width: 0;
      overflow: hidden;
      color: var(--ink);
      font-family: var(--ui);
      background:
        radial-gradient(circle at 8% -8%, rgba(140, 255, 113, 0.18), transparent 30rem),
        radial-gradient(circle at 92% 4%, rgba(255, 200, 87, 0.12), transparent 28rem),
        linear-gradient(rgba(110, 255, 132, 0.065) 1px, transparent 1px),
        linear-gradient(90deg, rgba(110, 255, 132, 0.065) 1px, transparent 1px),
        var(--bg);
      background-size: auto, auto, 32px 32px, 32px 32px, auto;
    }
    body::before {
      position: fixed;
      inset: 0;
      pointer-events: none;
      content: "";
      background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 4px);
      opacity: 0.38;
    }
    button, code, pre { font: inherit; }
    h1, h2, h3, p, pre { margin: 0; }
    code { color: var(--amber); }
    .shell {
      position: relative;
      z-index: 1;
      height: 100svh;
      padding: 12px;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 10px;
    }
    .topbar {
      display: grid;
      grid-template-columns: minmax(220px, 1.15fr) repeat(auto-fit, minmax(132px, 0.72fr));
      gap: 8px;
    }
    .card, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
      border-radius: 6px;
    }
    .card {
      min-height: 64px;
      padding: 10px 12px;
      overflow: hidden;
    }
    .label {
      color: var(--green);
      font: 700 10px/1 var(--mono);
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .value {
      margin-top: 7px;
      color: var(--ink);
      font: 600 13px/1.28 var(--mono);
      overflow-wrap: anywhere;
    }
    .value.muted, .muted { color: var(--muted); font-weight: 500; }
    .value.bad { color: var(--red); }
    .grid {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(390px, 1.08fr) minmax(340px, 0.92fr) minmax(430px, 1.12fr);
      grid-template-rows: minmax(0, 1fr) minmax(230px, 0.58fr);
      gap: 10px;
    }
    .panel {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
    }
    .panel-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      background: linear-gradient(90deg, rgba(140, 255, 113, 0.10), rgba(7, 11, 8, 0.24));
      border-bottom: 1px solid var(--line);
    }
    .panel-header h1, .panel-header h2 {
      color: #f7ffe4;
      font: 800 13px/1 var(--mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .panel-header p { color: var(--muted); font: 11px/1.35 var(--mono); overflow-wrap: anywhere; }
    .screen-panel { grid-row: 1; grid-column: 1; }
    .screen-wrap { position: relative; min-height: 0; display: grid; place-items: center; background: #020302; }
    #live-frame { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
    .screen-hud {
      position: absolute;
      left: 10px;
      right: 10px;
      bottom: 10px;
      display: grid;
      gap: 6px;
      padding: 10px;
      color: var(--muted);
      font: 11px/1.35 var(--mono);
      background: rgba(7, 11, 8, 0.72);
      border: 1px solid var(--line);
      border-radius: 6px;
      pointer-events: none;
    }
    .status-line { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      padding: 4px 7px;
      color: var(--ink);
      background: rgba(140, 255, 113, 0.09);
      border: 1px solid rgba(140, 255, 113, 0.20);
      border-radius: 999px;
      white-space: nowrap;
    }
    .chip.warn { color: var(--amber); background: rgba(255, 200, 87, 0.10); border-color: rgba(255, 200, 87, 0.24); }
    .chip.bad { color: var(--red); background: rgba(255, 118, 92, 0.10); border-color: rgba(255, 118, 92, 0.24); }
    .state-panel { grid-row: 1; grid-column: 2; }
    .llm-panel { grid-row: 1 / span 2; grid-column: 3; }
    .context-panel { grid-row: 2; grid-column: 1 / span 2; }
    .scroll { min-height: 0; overflow: auto; }
    .state-body, .context-body, .event-list, .llm-detail, .raw-log { padding: 10px; }
    .state-block { display: grid; gap: 8px; }
    .kv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .kv {
      padding: 9px;
      background: var(--panel-soft);
      border: 1px solid rgba(196, 255, 166, 0.12);
      border-radius: 4px;
    }
    .kv b { display: block; margin-bottom: 5px; color: var(--muted); font: 10px/1 var(--mono); text-transform: uppercase; letter-spacing: 0.1em; }
    .kv span { color: var(--ink); font: 12px/1.35 var(--mono); overflow-wrap: anywhere; }
    .pretty-text, .mono-block {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: var(--muted);
      font: 11px/1.42 var(--mono);
    }
    .mono-block {
      padding: 10px;
      background: rgba(0, 0, 0, 0.22);
      border: 1px solid rgba(196, 255, 166, 0.12);
    }
    .raw-log { margin: 0; min-height: 100%; }
    .context-tabs, .llm-tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px 0; background: rgba(7, 11, 8, 0.35); }
    .tab {
      padding: 6px 8px;
      color: var(--muted);
      cursor: pointer;
      background: rgba(0,0,0,0.22);
      border: 1px solid rgba(196, 255, 166, 0.12);
      border-bottom-color: var(--line);
      border-radius: 4px 4px 0 0;
      font: 700 10px/1 var(--mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
    }
    .tab.active { color: var(--ink); border-color: var(--line-strong); background: rgba(140, 255, 113, 0.10); }
    .llm-layout { min-height: 0; display: grid; grid-template-columns: 170px minmax(0, 1fr); }
    .llm-rail { min-height: 0; overflow: auto; border-right: 1px solid var(--line); }
    .history-button {
      width: 100%;
      display: block;
      padding: 10px;
      color: var(--muted);
      text-align: left;
      cursor: pointer;
      background: transparent;
      border: 0;
      border-bottom: 1px solid rgba(196, 255, 166, 0.12);
      font: 11px/1.35 var(--mono);
      white-space: pre-wrap;
      transition: color 0.15s ease, background 0.15s ease;
    }
    .history-button:hover, .history-button.active { color: var(--ink); background: rgba(140, 255, 113, 0.08); }
    .decision-card { display: grid; gap: 8px; margin-bottom: 10px; padding: 10px; color: var(--ink); background: rgba(140,255,113,0.08); border: 1px solid var(--line-strong); }
    .injection-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-bottom: 10px; }
    .injection-summary .kv { min-height: 64px; }
    .event-list { display: grid; gap: 8px; }
    .event-item { padding: 0; color: var(--muted); background: var(--panel-soft); border: 1px solid rgba(196, 255, 166, 0.12); font: 11px/1.35 var(--mono); overflow-wrap: anywhere; }
    .event-header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: rgba(0,0,0,0.18); border-bottom: 1px solid rgba(196, 255, 166, 0.10); }
    .event-badge { padding: 3px 7px; border-radius: 999px; font: 700 9px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; }
    .event-badge.action { color: var(--green); background: rgba(140, 255, 113, 0.12); border: 1px solid rgba(140, 255, 113, 0.22); }
    .event-badge.error { color: var(--red); background: rgba(255, 118, 92, 0.12); border: 1px solid rgba(255, 118, 92, 0.22); }
    .event-badge.state { color: #7ec8e3; background: rgba(126, 200, 227, 0.12); border: 1px solid rgba(126, 200, 227, 0.22); }
    .event-badge.decision { color: var(--amber); background: rgba(255, 200, 87, 0.12); border: 1px solid rgba(255, 200, 87, 0.22); }
    .event-badge.screenshot { color: var(--muted); background: rgba(145, 164, 135, 0.10); border: 1px solid rgba(145, 164, 135, 0.20); }
    .event-body { padding: 8px 10px; }
    .kv-mini { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 10px; padding: 6px 0; }
    .kv-mini + .kv-mini { border-top: 1px solid rgba(196, 255, 166, 0.08); }
    .kv-mini b { color: var(--muted-2); font: 10px/1.3 var(--mono); text-transform: uppercase; letter-spacing: 0.08em; }
    .kv-mini span { color: var(--ink); font: 11px/1.35 var(--mono); overflow-wrap: anywhere; }
    .event-payload { margin: 8px 0 0; padding: 8px; background: rgba(0,0,0,0.22); border: 1px solid rgba(196, 255, 166, 0.10); border-radius: 4px; }
    .event-payload pre { margin: 0; color: var(--muted-2); font: 10px/1.4 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .empty { display: grid; min-height: 100%; place-items: center; padding: 18px; color: var(--muted-2); text-align: center; font: 12px/1.4 var(--mono); }
    .action-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font: 700 11px/1 var(--mono); }
    .action-badge .btn { padding: 2px 7px; border-radius: 4px; color: #2a1f00; background: var(--amber); font: 800 11px/1 var(--mono); }
    .rationale-block { padding: 8px 10px; border-left: 3px solid var(--green); background: rgba(140, 255, 113, 0.06); color: var(--muted); font: 11px/1.45 var(--mono); }
    .confidence-bar { height: 6px; border-radius: 999px; background: rgba(0,0,0,0.35); border: 1px solid rgba(196, 255, 166, 0.12); overflow: hidden; }
    .confidence-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--red), var(--amber), var(--green)); }
    .citations-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .citation-chip { padding: 3px 8px; border-radius: 999px; color: var(--ink); background: rgba(140, 255, 113, 0.10); border: 1px solid rgba(140, 255, 113, 0.22); font: 10px/1 var(--mono); }
    .thinking-panel { margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.22); border: 1px solid rgba(196, 255, 166, 0.12); }
    .thinking-panel pre { margin: 0; color: var(--muted-2); font: 10px/1.45 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .map-section { margin-top: 10px; }
    .map-section h3 { margin-bottom: 8px; color: var(--green); font: 700 10px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; }
    .map-grid {
      display: inline-grid;
      gap: 1px;
      padding: 8px;
      background: rgba(0,0,0,0.35);
      border: 1px solid rgba(196, 255, 166, 0.14);
      border-radius: 6px;
    }
    .map-cell {
      width: 16px;
      height: 16px;
      display: grid;
      place-items: center;
      font: 700 9px/1 var(--mono);
      border-radius: 2px;
    }
    .map-cell.walk { background: rgba(140, 255, 113, 0.10); color: var(--muted); }
    .map-cell.wall { background: rgba(100, 114, 95, 0.35); color: var(--muted-2); }
    .map-cell.grass { background: rgba(140, 255, 113, 0.22); color: var(--green); }
    .map-cell.player { background: #8cff71; color: #0a1f06; animation: pulse 1.6s ease-in-out infinite; }
    .map-cell.npc { background: rgba(255, 200, 87, 0.35); color: var(--amber); }
    .map-cell.warp { background: rgba(180, 140, 255, 0.22); color: #d4b8ff; }
    .map-cell.unknown { background: rgba(145, 164, 135, 0.06); color: var(--muted-2); }
    @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(140, 255, 113, 0.55); } 50% { box-shadow: 0 0 6px 2px rgba(140, 255, 113, 0.25); } }
    .map-legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 8px; }
    .map-legend .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }
    .map-legend .swatch.player { background: #8cff71; }
    .map-legend .swatch.wall { background: rgba(100, 114, 95, 0.55); }
    .map-legend .swatch.walk { background: rgba(140, 255, 113, 0.25); }
    .map-legend .swatch.grass { background: rgba(140, 255, 113, 0.35); }
    .map-legend .swatch.npc { background: rgba(255, 200, 87, 0.45); }
    .map-legend .swatch.warp { background: rgba(180, 140, 255, 0.35); }
    .map-legend .swatch.unknown { background: rgba(145, 164, 135, 0.15); }
    .map-legend span { font: 10px/1 var(--mono); color: var(--muted); }
    .timeline { display: grid; gap: 0; }
    .timeline-step { position: relative; padding: 12px; padding-left: 28px; border-left: 2px solid var(--line); }
    .timeline-step:last-child { border-left-color: transparent; }
    .timeline-step::before {
      content: attr(data-step);
      position: absolute;
      left: -9px;
      top: 12px;
      width: 18px;
      height: 18px;
      display: grid;
      place-items: center;
      font: 700 9px/1 var(--mono);
      color: var(--bg);
      background: var(--green);
      border-radius: 50%;
    }
    .timeline-step.thinking::before { background: var(--amber); }
    .timeline-step.deciding::before { background: #7ec8e3; }
    .step-title { margin-bottom: 8px; color: var(--green); font: 700 11px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; }
    .step-title.thinking { color: var(--amber); }
    .step-title.deciding { color: #7ec8e3; }
    .rule-chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0; }
    .rule-chip { padding: 3px 7px; border-radius: 999px; font: 600 9px/1 var(--mono); letter-spacing: 0.04em; }
    .rule-chip.mode { color: var(--green); background: rgba(140, 255, 113, 0.12); border: 1px solid rgba(140, 255, 113, 0.25); }
    .rule-chip.rule { color: var(--muted); background: rgba(145, 164, 135, 0.12); border: 1px solid rgba(145, 164, 135, 0.22); }
    .rule-chip.hint { color: var(--amber); background: rgba(255, 200, 87, 0.12); border: 1px solid rgba(255, 200, 87, 0.25); }
    .state-summary { display: grid; gap: 4px; margin-top: 8px; }
    .state-summary-item { padding: 6px 8px; background: rgba(0,0,0,0.18); border-left: 2px solid var(--line); font: 11px/1.35 var(--mono); color: var(--muted); }
    .state-summary-item b { color: var(--green); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; display: block; margin-bottom: 3px; }
    .reasoning-block { padding: 10px; background: rgba(255, 200, 87, 0.06); border: 1px solid rgba(255, 200, 87, 0.18); border-radius: 4px; color: var(--ink); font: 11px/1.45 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .reasoning-block.muted { color: var(--muted-2); font-style: italic; }
    details { margin-top: 6px; }
    details summary { cursor: pointer; color: var(--muted); font: 10px/1.35 var(--mono); padding: 4px 0; }
    details summary:hover { color: var(--ink); }
    details .collapsed-content { margin-top: 6px; padding: 8px; background: rgba(0,0,0,0.22); border: 1px solid rgba(196, 255, 166, 0.10); border-radius: 4px; font: 10px/1.4 var(--mono); color: var(--muted-2); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 300px; overflow: auto; }
    .prompt-section { margin-bottom: 10px; padding: 10px; background: var(--panel-soft); border: 1px solid rgba(196, 255, 166, 0.12); border-radius: 4px; }
    .prompt-section-title { margin-bottom: 8px; color: var(--green); font: 700 10px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; }
    .prompt-section-body .mono-block { margin: 0; }
    .history-entry { padding: 6px 8px; margin-bottom: 4px; border-radius: 4px; font: 11px/1.35 var(--mono); }
    .history-entry:last-child { margin-bottom: 0; }
    .history-success { color: var(--green); background: rgba(140, 255, 113, 0.08); border: 1px solid rgba(140, 255, 113, 0.18); }
    .history-failed { color: var(--red); background: rgba(255, 118, 92, 0.08); border: 1px solid rgba(255, 118, 92, 0.18); }
    @media (max-width: 1320px) {
      body { overflow: auto; }
      .shell { min-height: 100svh; height: auto; }
      .grid {
        grid-template-columns: minmax(360px, 1.1fr) minmax(360px, 0.9fr);
        grid-template-rows: minmax(420px, 44vh) minmax(420px, auto) minmax(300px, auto);
      }
      .screen-panel { grid-row: 1; grid-column: 1; }
      .state-panel { grid-row: 1; grid-column: 2; }
      .llm-panel { grid-row: 2; grid-column: 1 / span 2; }
      .context-panel { grid-row: 3; grid-column: 1 / span 2; }
    }
    @media (max-width: 820px) {
      .shell { padding: 8px; }
      .topbar { grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); }
      .grid { grid-template-columns: 1fr; grid-template-rows: none; }
      .screen-panel, .state-panel, .llm-panel, .context-panel { grid-row: auto; grid-column: auto; min-height: 320px; }
      .screen-panel { min-height: 420px; }
      .llm-layout { grid-template-columns: 1fr; }
      .llm-rail { max-height: 160px; border-right: 0; border-bottom: 1px solid var(--line); }
      .kv-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="topbar" aria-label="런 요약">
      <article class="card"><div class="label">런 ID</div><div id="summary-run" class="value">${escapeHtml(runId)}</div></article>
      <article class="card"><div class="label">상태</div><div id="summary-status" class="value muted">로딩 중...</div></article>
      <article class="card"><div class="label">진행</div><div id="summary-progress" class="value muted">대기 중...</div></article>
      <article class="card"><div class="label">맵</div><div id="summary-map" class="value muted">대기 중...</div></article>
      <article class="card"><div class="label">파티</div><div id="summary-party" class="value muted">대기 중...</div></article>
      <article class="card"><div class="label">플레이어 행동</div><div id="summary-player" class="value muted">대기 중...</div></article>
      <article class="card"><div class="label">갱신</div><div id="summary-refresh" class="value muted">시작 중...</div></article>
    </section>

    <section class="grid" aria-label="실시간 관측 대시보드">
      <article class="panel screen-panel">
        <div class="panel-header"><h1>실시간 게임 화면</h1><p>mGBA 프레임 · <code>${escapeHtml(runId)}</code></p></div>
        <div class="screen-wrap">
          <img id="live-frame" src="/api/live-frame" alt="실시간 mGBA 화면">
          <div class="screen-hud">
            <div id="screen-location" class="status-line"><span class="chip">상태 대기 중</span></div>
            <div id="screen-dialog" class="muted">대화/텍스트가 여기에 표시됩니다.</div>
          </div>
        </div>
      </article>

      <article class="panel state-panel">
        <div class="panel-header"><h2>현재 상태</h2><p id="state-status">RAM 스냅샷 대기 중...</p></div>
        <div class="state-body scroll">
          <div id="game-state" class="state-block"></div>
        </div>
      </article>

      <article class="panel llm-panel">
        <div class="panel-header"><h2>LLM 프롬프트 + 판단</h2><p id="llm-status">대기 중...</p></div>
        <div class="llm-layout">
          <div class="llm-rail"><div id="llm-history"></div></div>
          <div class="panel" style="border:0; box-shadow:none; background:transparent">
            <div class="llm-tabs">
              <button class="tab active" data-llm-tab="overview">판단</button>
              <button class="tab" data-llm-tab="system">시스템</button>
              <button class="tab" data-llm-tab="state">상태</button>
              <button class="tab" data-llm-tab="user">주입</button>
              <button class="tab" data-llm-tab="raw">원본</button>
            </div>
            <div class="llm-detail scroll"><div id="llm-conversation" class="pretty-text">LLM 대화 기록이 없습니다.</div></div>
          </div>
        </div>
      </article>

      <article class="panel context-panel">
        <div class="panel-header"><h2>런 로그</h2><p id="context-status">이벤트 로딩 중...</p></div>
        <div class="context-tabs">
          <button class="tab active" data-context-tab="events">이벤트</button>
          <button class="tab" data-context-tab="raw">원본 로그</button>
        </div>
        <div class="context-body scroll">
          <div id="event-list" class="event-list"></div>
          <pre id="raw-log" class="raw-log mono-block" hidden>런 로그가 없습니다.</pre>
        </div>
      </article>
    </section>
  </main>
  <script>
    const liveFrame = document.getElementById('live-frame');
    const llmStatus = document.getElementById('llm-status');
    const llmConversation = document.getElementById('llm-conversation');
    const llmHistory = document.getElementById('llm-history');
    const eventList = document.getElementById('event-list');
    const rawLog = document.getElementById('raw-log');
    const stateStatus = document.getElementById('state-status');
    const gameState = document.getElementById('game-state');
    const summaryStatus = document.getElementById('summary-status');
    const summaryProgress = document.getElementById('summary-progress');
    const summaryMap = document.getElementById('summary-map');
    const summaryParty = document.getElementById('summary-party');
    const summaryPlayer = document.getElementById('summary-player');
    const summaryRefresh = document.getElementById('summary-refresh');
    const screenLocation = document.getElementById('screen-location');
    const screenDialog = document.getElementById('screen-dialog');
    const contextStatus = document.getElementById('context-status');
    let selectedConversationFile = null;
    let selectedLlmTab = 'overview';
    let selectedContextTab = 'events';
    let latestConversation = null;

    function text(node, value) { node.appendChild(document.createTextNode(value)); }
    function value(value, fallback = '?') { return value === undefined || value === null || value === '' ? fallback : String(value); }
    function boolText(value) { return value ? '예' : '아니오'; }
    function compactJson(input) { return JSON.stringify(input ?? {}, null, 2); }
    function setRefreshLabel() { summaryRefresh.textContent = new Date().toLocaleTimeString(); }

    for (const tab of document.querySelectorAll('[data-llm-tab]')) {
      tab.addEventListener('click', () => {
        selectedLlmTab = tab.getAttribute('data-llm-tab');
        document.querySelectorAll('[data-llm-tab]').forEach((node) => node.classList.toggle('active', node === tab));
        renderSelectedConversation();
      });
    }
    for (const tab of document.querySelectorAll('[data-context-tab]')) {
      tab.addEventListener('click', () => {
        selectedContextTab = tab.getAttribute('data-context-tab');
        document.querySelectorAll('[data-context-tab]').forEach((node) => node.classList.toggle('active', node === tab));
        eventList.hidden = selectedContextTab !== 'events';
        rawLog.hidden = selectedContextTab !== 'raw';
      });
    }

    async function refreshLiveFrame() {
      liveFrame.src = '/api/live-frame?nonce=' + Date.now();
    }

    async function refreshLlmConversation() {
      const payload = await fetch('/api/llm-conversations?limit=20', { cache: 'no-store' }).then((response) => response.json());
      if (!payload.conversations || payload.conversations.length === 0) {
        llmStatus.textContent = 'LLM 요청 기록 없음';
        llmHistory.textContent = '';
        latestConversation = null;
        renderSelectedConversation();
        return;
      }
      if (!selectedConversationFile || !payload.conversations.some((item) => item.fileName === selectedConversationFile)) {
        selectedConversationFile = payload.conversations[0].fileName;
      }
      llmHistory.textContent = '';
      for (const conversation of payload.conversations) {
        const button = document.createElement('button');
        button.className = 'history-button' + (conversation.fileName === selectedConversationFile ? ' active' : '');
        button.textContent = conversation.fileName + '\\n호출 ' + value(conversation.call) + ' · ' + summarizeAction(conversation) + '\\n' + conversationStatus(conversation);
        button.onclick = () => {
          selectedConversationFile = conversation.fileName;
          latestConversation = conversation;
          for (const node of llmHistory.querySelectorAll('.history-button')) node.classList.remove('active');
          button.classList.add('active');
          renderSelectedConversation();
        };
        llmHistory.appendChild(button);
      }
      latestConversation = payload.conversations.find((item) => item.fileName === selectedConversationFile) ?? payload.conversations[0];
      llmStatus.textContent = payload.count + ' 저장됨 · 최신 ' + payload.conversations[0].fileName + ' · ' + conversationStatus(payload.conversations[0]);
      renderSelectedConversation();
    }

    async function refreshGameState() {
      const payload = await fetch('/api/game-state?limit=8', { cache: 'no-store' }).then((response) => response.json());
      if (!payload.latest) {
        stateStatus.textContent = '게임 상태 스냅샷 없음';
        gameState.textContent = '';
        summaryMap.textContent = '상태 없음';
        summaryParty.textContent = '상태 없음';
        screenLocation.textContent = '';
        const chip = document.createElement('span');
        chip.className = 'chip warn';
        chip.textContent = '상태 대기 중';
        screenLocation.appendChild(chip);
        screenDialog.textContent = '대화/텍스트가 여기에 표시됩니다.';
        return;
      }
      const latest = payload.latest;
      const state = unwrapState(latest);
      stateStatus.textContent = payload.count + '/' + payload.limit + ' 스냅샷 · 최신 ' + latest.fileName;
      renderStructuredState(latest, state);
      updateStateCards(latest, state);
    }

    async function refreshEvents() {
      const payload = await fetch('/api/events?limit=80', { cache: 'no-store' }).then((response) => response.json());
      eventList.textContent = '';
      rawLog.textContent = compactJson({
        runId: payload.runId,
        limit: payload.limit,
        count: payload.count,
        events: payload.events ?? []
      });
      contextStatus.textContent = (payload.events ? payload.events.length : 0) + '개 이벤트';
      if (!payload.events || payload.events.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '런 이벤트가 없습니다.';
        eventList.appendChild(empty);
        return;
      }
      for (const event of payload.events) {
        const item = document.createElement('article');
        item.className = 'event-item';
        item.innerHTML = renderEventCard(event);
        eventList.appendChild(item);
      }
    }

    async function refreshRunSummary() {
      const summary = await fetch('/api/run-summary', { cache: 'no-store' }).then((response) => response.json());
      summaryStatus.textContent = summary.status ?? '알 수 없음';
      summaryStatus.className = 'value ' + ((summary.status ?? '').startsWith('failed') ? 'bad' : '');
      const counts = summary.counts ?? {};
      summaryProgress.textContent = '스텝 ' + value(summary.totalSteps) + ' · 판단 ' + (counts.decisions ?? 0) + ' · 오류 ' + (counts.errors ?? 0);
      summaryPlayer.textContent = summary.lastAction
        ? summarizeAction({ parsedDecision: { command: summary.lastAction.command, action: summary.lastAction.action } }) + ' · ' + (summary.lastAction.rationale ?? '근거 없음')
        : '플레이어 행동 없음';
    }

    function updateStateCards(snapshot, state) {
      const mapId = state?.map?.mapId ?? state?.coordinates?.mapId ?? state?.wCurMap ?? state?.mapId;
      const mapName = state?.map?.mapName;
      const y = state?.player?.position?.y ?? state?.coordinates?.y ?? state?.wYCoord ?? state?.y;
      const x = state?.player?.position?.x ?? state?.coordinates?.x ?? state?.wXCoord ?? state?.x;
      const facing = state?.player?.facing?.direction ?? state?.playerFacing?.direction ?? state?.playerFacingDirection;
      const partyCount = state?.party?.count ?? state?.wPartyCount ?? state?.partyCount;
      const hp = state?.party?.firstPokemonHp ?? {};
      const lead = Array.isArray(state?.party?.members) ? state.party.members[0] : undefined;
      const badgeCount = state?.player?.badges?.count ?? state?.badges?.count ?? state?.badgeCount;
      const battle = state?.battle?.inBattle ?? state?.battle?.kind ?? state?.wIsInBattle;
      const dialog = dialogText(state);
      summaryMap.textContent = (mapName ? mapName + ' ' : '') + '맵 ' + value(mapId) + ' · y' + value(y) + ' x' + value(x);
      summaryParty.textContent = lead
        ? partyCount + '/6 · ' + lead.nickname + ' Lv' + lead.level + ' HP ' + lead.hp + '/' + lead.maxHp
        : value(partyCount, 0) + '/6 · 선두 HP ' + value(hp.current ?? state?.wPartyMon1HP) + '/' + value(hp.max ?? state?.wPartyMon1MaxHP);
      screenLocation.textContent = '';
      for (const chip of [
        '맵 ' + value(mapId),
        'y' + value(y) + ' x' + value(x),
        '방향 ' + value(facing),
        '배지 ' + value(badgeCount, 0),
        '배틀 ' + value(battle)
      ]) {
        const node = document.createElement('span');
        node.className = 'chip';
        node.textContent = chip;
        screenLocation.appendChild(node);
      }
      screenDialog.textContent = dialog || '활성 대화/텍스트 없음';
    }

    function stateEntries(snapshot, state) {
      const mapId = state?.map?.mapId ?? state?.coordinates?.mapId ?? state?.wCurMap ?? state?.mapId;
      const mapName = state?.map?.mapName;
      const y = state?.player?.position?.y ?? state?.coordinates?.y ?? state?.wYCoord ?? state?.y;
      const x = state?.player?.position?.x ?? state?.coordinates?.x ?? state?.wXCoord ?? state?.x;
      const facing = state?.player?.facing?.direction ?? state?.playerFacing?.direction ?? state?.playerFacingDirection;
      const badges = state?.player?.badges?.names?.join(', ') || state?.badges?.names?.join(', ') || '없음';
      const badgeCount = state?.player?.badges?.count ?? state?.badges?.count ?? state?.badgeCount ?? 0;
      const battleKind = state?.battle?.type ?? state?.battle?.kind ?? state?.battleState?.flag?.kind ?? (state?.wIsInBattle ? '배틀' : '없음');
      const partyCount = state?.party?.count ?? state?.wPartyCount ?? state?.partyCount;
      const hp = state?.party?.firstPokemonHp ?? {};
      const lead = Array.isArray(state?.party?.members) ? state.party.members[0] : undefined;
      const dialog = state?.dialog?.active ?? state?.textActive ?? Boolean(dialogText(state));
      return [
        ['스냅샷', '스텝 ' + value(snapshot.state?.step ?? snapshot.step) + ' · 프레임 ' + value(snapshot.state?.frame ?? snapshot.frame)],
        ['위치', (mapName ? mapName + ' · ' : '') + '맵 ' + value(mapId) + ' · y=' + value(y) + ' x=' + value(x) + ' · ' + value(facing)],
        ['진행도', '배지 ' + badgeCount + ' (' + badges + ') · 명예의 전당 ' + boolText(Boolean(state?.hallOfFameComplete))],
        ['파티', lead ? lead.nickname + ' ' + lead.species + ' Lv' + lead.level + ' HP ' + lead.hp + '/' + lead.maxHp : value(partyCount, 0) + '/6 · 선두 HP ' + value(hp.current ?? state?.wPartyMon1HP) + '/' + value(hp.max ?? state?.wPartyMon1MaxHP)],
        ['배틀', battleKind + (state?.battle?.enemy ? ' · 적 ' + state.battle.enemy.species + ' Lv' + state.battle.enemy.level : '')],
        ['대화/메뉴', '활성 ' + boolText(Boolean(dialog)) + ' · 텍스트박스 ' + value(state?.dialog?.textBoxId ?? state?.textBoxId ?? state?.wTextBoxID) + ' · 메뉴 ' + value(state?.menuText?.currentMenuItem ?? state?.menuItem)]
      ];
    }

    function unwrapState(snapshot) {
      return snapshot?.state?.state ?? snapshot?.state ?? snapshot;
    }

    function dialogText(state) {
      return state?.menuText?.screenText || state?.screenText || '';
    }

    function formatEvent(event) {
      const header = '[' + (event.sequence ?? '-') + '] ' + event.type + ' · ' + (event.timestamp ?? '');
      return header + '\\n' + compactJson(event.payload ?? {});
    }

    function eventTypeClass(type) {
      if (type === 'action') return 'action';
      if (type === 'error') return 'error';
      if (type === 'state') return 'state';
      if (type === 'decision') return 'decision';
      return 'screenshot';
    }

    function eventBodyRows(event) {
      const rows = [];
      const p = event.payload ?? {};
      if (p.command) rows.push(['명령', compactJson(p.command)]);
      if (p.action) rows.push(['행동', String(p.action)]);
      if (p.result) rows.push(['결과', compactJson(p.result)]);
      if (p.rationale) rows.push(['근거', String(p.rationale)]);
      if (p.frame !== undefined) rows.push(['프레임', String(p.frame)]);
      if (p.step !== undefined) rows.push(['스텝', String(p.step)]);
      if (event.sequence !== undefined) rows.push(['시퀀스', String(event.sequence)]);
      return rows;
    }

    function renderEventCard(event) {
      const typeClass = eventTypeClass(event.type);
      const rows = eventBodyRows(event);
      let body = '<div class="event-header"><span class="event-badge ' + typeClass + '">' + escapeHtml(event.type) + '</span><span class="muted">' + escapeHtml(event.timestamp ?? '') + '</span></div>';
      body += '<div class="event-body">';
      if (rows.length > 0) {
        body += '<div class="kv-mini">';
        for (const row of rows) {
          body += '<b>' + escapeHtml(row[0]) + '</b><span>' + escapeHtml(row[1]) + '</span>';
        }
        body += '</div>';
      }
      body += '<div class="event-payload"><pre>' + escapeHtml(compactJson(event.payload ?? {})) + '</pre></div>';
      body += '</div>';
      return body;
    }

    function renderSelectedConversation() {
      if (!latestConversation) {
        llmConversation.textContent = 'LLM 대화 기록이 없습니다.';
        return;
      }
      if (selectedLlmTab === 'overview') llmConversation.innerHTML = formatConversationOverview(latestConversation);
      else if (selectedLlmTab === 'state' || selectedLlmTab === 'user') llmConversation.innerHTML = formatConversationTab(latestConversation, selectedLlmTab);
      else llmConversation.textContent = formatConversationTab(latestConversation, selectedLlmTab);
    }

    function extractReasoning(conversation) {
      const raw = conversation.responseContent ?? '';
      const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/);
      const thinkContent = thinkMatch ? thinkMatch[1].trim() : null;
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const nonJsonPart = jsonMatch ? raw.slice(0, jsonMatch.index).trim() : null;
      const reasoning = thinkContent || (nonJsonPart && nonJsonPart.length > 10 ? nonJsonPart : null);
      const rationale = conversation.parsedDecision?.rationale;
      return {
        thinking: reasoning,
        rationale: rationale,
        hasExplicitThinking: !!reasoning,
        rawThinkTag: thinkContent,
      };
    }

    function extractSystemChips(conversation) {
      const system = (conversation.messages ?? []).filter((m) => m.role === 'system').map(messageText).join('\n');
      const mode = conversation.mode ?? conversation.harnessMode ?? 'unknown';
      const chips = [];
      chips.push({ label: mode, type: 'mode' });
      if (system.includes('World Rules') || system.includes('월드 규칙')) chips.push({ label: '월드 규칙', type: 'rule' });
      if (system.includes('Progression')) chips.push({ label: '진행 모델', type: 'rule' });
      if (system.includes('NPC Rules') || system.includes('NPC')) chips.push({ label: 'NPC 규칙', type: 'rule' });
      if (system.includes('Stuck Patterns') || system.includes('막힘')) chips.push({ label: '막힘 패턴', type: 'rule' });
      if (system.includes('navigate')) chips.push({ label: '이동', type: 'rule' });
      if (system.includes('interact')) chips.push({ label: '상호작용', type: 'rule' });
      if (system.includes('battle')) chips.push({ label: '전투', type: 'rule' });
      if (system.includes('dialog')) chips.push({ label: '대화', type: 'rule' });
      const user = (conversation.messages ?? []).filter((m) => m.role === 'user').map(messageText).join('\n');
      if (user.includes('[ADVISER HINT]')) chips.push({ label: '조언자 힌트', type: 'hint' });
      return { chips, systemText: system };
    }

    function formatConversationOverview(conversation) {
      const decision = conversation.parsedDecision;
      const error = conversation.error;
      const reasoning = extractReasoning(conversation);
      const { chips, systemText } = extractSystemChips(conversation);
      const lines = [];

      const mode = conversation.mode ?? conversation.harnessMode ?? 'unknown';
      const cmd = decision?.command;
      const action = decision?.action;
      let actionText = '없음';
      if (cmd) {
        if (cmd.type === 'navigate') actionText = 'navigate(' + value(cmd.x) + ',' + value(cmd.y) + ')';
        else if (cmd.type === 'interact') actionText = 'interact(' + value(cmd.direction, '현재') + ')';
        else if (cmd.type === 'wait') actionText = '대기 ' + value(cmd.frames) + 'f';
        else if (cmd.type === 'raw') actionText = 'raw [' + (cmd.inputs ?? []).join(',') + ']';
        else actionText = cmd.type;
      } else if (action) {
        actionText = action.type + ' ' + value(action.button) + ' ' + value(action.frames);
      }
      lines.push('<div class="decision-card" style="padding:8px 10px; margin-bottom:0; display:flex; align-items:center; justify-content:space-between; gap:8px">');
      lines.push('<div style="display:flex; align-items:center; gap:8px">');
      lines.push('<span class="chip">MODEL</span>');
      lines.push('<span style="font:600 12px/1 var(--mono)">CALL #' + escapeHtml(value(conversation.call)) + '</span>');
      lines.push('<span class="chip">' + escapeHtml(String(mode).toUpperCase()) + '</span>');
      lines.push('</div>');
      if (error) {
        lines.push('<span class="action-badge" style="color:var(--red); background:rgba(255,118,92,0.12); border:1px solid rgba(255,118,92,0.22)">' + escapeHtml(error.code) + '</span>');
      } else if (decision) {
        lines.push('<span class="action-badge"><span class="btn">' + escapeHtml(value(cmd?.type ?? action?.type)) + '</span> ' + escapeHtml(actionText) + '</span>');
      } else {
        lines.push('<span class="action-badge" style="color:var(--muted); background:rgba(145,164,135,0.10); border:1px solid rgba(145,164,135,0.20)">대기 중</span>');
      }
      lines.push('</div>');

      lines.push('<div class="timeline">');

      lines.push('<div class="timeline-step" data-step="1">');
      lines.push('<div class="step-title">1. 본 것</div>');
      lines.push('<div class="rule-chips">');
      for (const chip of chips) {
        lines.push('<span class="rule-chip ' + chip.type + '">' + escapeHtml(chip.label) + '</span>');
      }
      lines.push('</div>');
      if (systemText) {
        lines.push('<details><summary>시스템 프롬프트 보기</summary>');
        lines.push('<div class="collapsed-content">' + escapeHtml(systemText) + '</div>');
        lines.push('</details>');
      }
      const userText = formatConversationTab(conversation, 'user');
      const sections = parsePromptSections(userText);
      if (sections.length > 0) {
        lines.push('<div class="state-summary">');
        for (const section of sections) {
          const summary = section.content.split('\n').slice(0, 3).join('\n');
          const title = section.title;
          let label;
          if (title === 'PROGRESS') label = '진행';
          else if (title === 'LAST RESULT') label = '직전 결과';
          else if (title.startsWith('STATE:')) label = '현재 상태';
          else if (title === 'MAP GRAPH') label = '맵 연결';
          else if (title === 'CURRENT MAP') label = '현재 맵';
          else if (title === 'HISTORY') label = '최근 행동';
          else if (title === 'ADVISER HINT') label = '조언자 힌트';
          else label = title;
          lines.push('<div class="state-summary-item"><b>' + escapeHtml(label) + '</b>' + escapeHtml(summary) + '</div>');
        }
        lines.push('</div>');
      }
      lines.push('</div>');

      lines.push('<div class="timeline-step thinking" data-step="2">');
      lines.push('<div class="step-title thinking">2. 생각한 것</div>');
      if (reasoning.hasExplicitThinking) {
        lines.push('<div class="reasoning-block">' + escapeHtml(reasoning.thinking) + '</div>');
        if (reasoning.rawThinkTag) {
          lines.push('<details><summary>모델 내부 추론 원문 보기</summary>');
          lines.push('<div class="collapsed-content">' + escapeHtml(reasoning.rawThinkTag) + '</div>');
          lines.push('</details>');
        }
      } else {
        lines.push('<div class="reasoning-block muted">명시적 추론 없음</div>');
      }
      lines.push('</div>');

      lines.push('<div class="timeline-step deciding" data-step="3">');
      lines.push('<div class="step-title deciding">3. 결정한 것</div>');
      if (decision) {
        lines.push('<div><span class="action-badge"><span class="btn">' + escapeHtml(value(cmd?.type ?? action?.type)) + '</span> ' + escapeHtml(actionText) + '</span></div>');
        if (cmd && (cmd.x !== undefined || cmd.y !== undefined || cmd.direction !== undefined || cmd.frames !== undefined || cmd.inputs !== undefined)) {
          lines.push('<div class="rule-chips" style="margin-top:6px">');
          if (cmd.x !== undefined) lines.push('<span class="rule-chip rule">x=' + escapeHtml(String(cmd.x)) + '</span>');
          if (cmd.y !== undefined) lines.push('<span class="rule-chip rule">y=' + escapeHtml(String(cmd.y)) + '</span>');
          if (cmd.direction !== undefined) lines.push('<span class="rule-chip rule">dir=' + escapeHtml(String(cmd.direction)) + '</span>');
          if (cmd.frames !== undefined) lines.push('<span class="rule-chip rule">frames=' + escapeHtml(String(cmd.frames)) + '</span>');
          if (cmd.inputs !== undefined) lines.push('<span class="rule-chip rule">inputs=[' + escapeHtml((cmd.inputs ?? []).join(',')) + ']</span>');
          lines.push('</div>');
        }
        if (decision.rationale) {
          lines.push('<div class="rationale-block" style="margin-top:8px">' + escapeHtml(decision.rationale) + '</div>');
        }
        if (decision.confidence !== undefined) {
          const conf = Number(decision.confidence ?? 0);
          const confPct = Math.max(0, Math.min(100, Math.round(conf * 100)));
          lines.push('<div style="margin-top:8px"><span class="label">확신도</span><div class="confidence-bar"><div class="confidence-fill" style="width:' + confPct + '%"></div></div><div class="value" style="margin-top:4px">' + confPct + '%</div></div>');
        }
        const citations = decision.observedStateCitations ?? [];
        if (citations.length > 0) {
          lines.push('<div style="margin-top:8px"><span class="label">근거 출처</span><div class="citations-row">' + citations.map((c) => '<span class="citation-chip">' + escapeHtml(String(c)) + '</span>').join('') + '</div></div>');
        }
      } else if (error) {
        lines.push('<div><span class="label">오류</span><div class="value bad">' + escapeHtml(error.code + ': ' + error.message) + '</div></div>');
      } else {
        lines.push('<div><span class="label">상태</span><div class="value muted">판단 대기 중</div></div>');
      }
      lines.push('</div>');

      lines.push('</div>');
      return lines.join('');
    }

    function formatConversationTab(conversation, tab) {
      const messages = conversation.messages ?? [];
      const system = messages.filter((message) => message.role === 'system').map(messageText).join('\\n\\n');
      const user = messages.filter((message) => message.role === 'user').map(messageText).join('\\n\\n');
      if (tab === 'system') return system || '시스템 프롬프트 없음';
      if (tab === 'state') {
        const sections = parsePromptSections(user);
        return renderPromptSections(sections);
      }
      if (tab === 'user') {
        const sections = parsePromptSections(user);
        return renderPromptSections(sections);
      }
      if (tab === 'raw') {
        return [
          '[원본 응답]', conversation.responseContent ?? '원본 응답 없음',
          '',
          '[오류]', conversation.error ? compactJson(conversation.error) : '없음',
          '',
          '[전체 추적]', compactJson(conversation)
        ].join('\\n');
      }
      return formatConversation(conversation);
    }

    function messageText(message) {
      if (typeof message.content === 'string') return message.content;
      const chunks = [];
      for (const part of message.content ?? []) {
        if (part.type === 'text') chunks.push(part.text);
        if (part.type === 'image_url') chunks.push('[이미지 입력 생략' + (part.image_url?.detail ? ' detail=' + part.image_url.detail : '') + ']');
      }
      return chunks.join('\\n');
    }

    function parsePromptSections(userText) {
      if (!userText) return [];
      const sectionRegex = new RegExp('^\\\\[(PROGRESS|LAST RESULT|ADVISER HINT|STATE:[^\\\\]]+|MAP GRAPH|CURRENT MAP|HISTORY)\\\\]', 'gm');
      const sections = [];
      let match;
      const indices = [];
      while ((match = sectionRegex.exec(userText)) !== null) {
        indices.push({ index: match.index, title: match[0].slice(1, -1) });
      }
      for (let i = 0; i < indices.length; i++) {
        const start = indices[i].index;
        const end = i + 1 < indices.length ? indices[i + 1].index : userText.length;
        const block = userText.slice(start, end).trim();
        const content = block.slice(block.indexOf(']') + 1).trim();
        sections.push({ title: indices[i].title, content });
      }
      if (sections.length === 0) return [{ title: '프롬프트', content: userText }];
      return sections;
    }

    function renderPromptSections(sections) {
      if (!sections || sections.length === 0) return '';
      const parts = [];
      for (const section of sections) {
        const title = escapeHtml(section.title);
        let bodyHtml;
        if (section.title === 'CURRENT MAP') {
          const mapMatch = section.content.match(/^(.*?)\\n([\\s\\S]*?)\\n\\s*Legend:/);
          if (mapMatch) {
            const header = escapeHtml(mapMatch[1].trim());
            const mapBlock = mapMatch[2].trim();
            bodyHtml = '<div style="margin-bottom:6px">' + escapeHtml(header) + '</div>' + renderAsciiMap(mapBlock);
          } else {
            bodyHtml = '<pre class="mono-block">' + escapeHtml(section.content) + '</pre>';
          }
        } else if (section.title === 'HISTORY') {
          const entries = section.content.split('\\n').map((l) => l.trim()).filter(Boolean);
          const entryHtmls = [];
          for (const entry of entries) {
            const isFailed = entry.toLowerCase().includes('failed');
            const cls = isFailed ? 'history-failed' : 'history-success';
            entryHtmls.push('<div class="history-entry ' + cls + '">' + escapeHtml(entry) + '</div>');
          }
          bodyHtml = entryHtmls.join('');
        } else if (section.title === 'MAP GRAPH') {
          bodyHtml = '<pre class="mono-block">' + escapeHtml(section.content) + '</pre>';
        } else {
          bodyHtml = '<pre class="mono-block">' + escapeHtml(section.content) + '</pre>';
        }
        parts.push('<div class="prompt-section"><div class="prompt-section-title">' + title + '</div><div class="prompt-section-body">' + bodyHtml + '</div></div>');
      }
      return parts.join('');
    }

    function formatConversation(conversation) {
      const sections = [];
      sections.push('모델: ' + value(conversation.model) + ' | 모드: ' + value(conversation.mode ?? conversation.harnessMode) + ' | 호출: ' + value(conversation.call));
      if (conversation.parsedDecision !== undefined) {
        sections.push('\\n[판단]');
        sections.push(formatDecision(conversation.parsedDecision));
      }
      if (conversation.error !== undefined && conversation.error !== null) {
        sections.push('\\n[오류]');
        sections.push(compactJson(conversation.error));
      }
      if (conversation.responseContent !== undefined) {
        sections.push('\\n[원본 응답]');
        sections.push(conversation.responseContent);
      }
      sections.push('\\n[프롬프트 / 주입된 LLM 컨텍스트]');
      for (const message of conversation.messages ?? []) {
        sections.push('\\n[' + String(message.role).toUpperCase() + ']');
        sections.push(messageText(message));
      }
      return sections.join('\\n');
    }

    function formatStateSnapshot(snapshot) {
      const state = unwrapState(snapshot);
      const lines = [
        '파일: ' + snapshot.fileName,
        '스텝: ' + value(snapshot.state?.step ?? snapshot.step),
        '프레임: ' + value(snapshot.state?.frame ?? snapshot.frame),
        '상태해시: ' + value(snapshot.state?.stateHash ?? snapshot.stateHash),
        '',
        compactJson(state ?? snapshot)
      ];
      return lines.join('\\n');
    }

    function buildStateSections(snapshot, state) {
      return stateEntries(snapshot, state).map((entry) => ({ label: entry[0], value: entry[1] }));
    }

    function renderStructuredState(snapshot, state) {
      gameState.textContent = '';
      const sections = buildStateSections(snapshot, state);
      const grid = document.createElement('div');
      grid.className = 'kv-grid';
      for (const section of sections) {
        const item = document.createElement('div');
        item.className = 'kv';
        const label = document.createElement('b');
        label.textContent = section.label;
        const span = document.createElement('span');
        span.textContent = section.value;
        item.appendChild(label);
        item.appendChild(span);
        grid.appendChild(item);
      }
      gameState.appendChild(grid);
      const mapAscii = extractMapAsciiFromState(state);
      if (mapAscii) {
        const mapSection = document.createElement('div');
        mapSection.className = 'map-section';
        mapSection.innerHTML = '<h3>맵</h3>' + renderAsciiMap(mapAscii);
        gameState.appendChild(mapSection);
      }
      const dialog = dialogText(state);
      if (dialog) {
        const pre = document.createElement('pre');
        pre.className = 'mono-block';
        pre.textContent = '대화/텍스트\\n' + dialog;
        gameState.appendChild(pre);
      }
    }

    function extractMapAsciiFromState(state) {
      return state?.mapAscii ?? state?.map?.ascii ?? state?.asciiMap;
    }

    function extractMapAsciiFromConversation(conversation) {
      const user = (conversation.messages ?? []).filter((m) => m.role === 'user').map(messageText).join('\\n');
      if (!user) return null;
      const mapBlockRe = new RegExp('Current map \\\\(ASCII grid[^\\\\n]*\\\\n([\\\\s\\\\S]*?)\\\\n(?:Rules|Output schema|Recent actions)');
      const tileRowRe = new RegExp('^\\\\s*\\\\d+\\\\s+[.#"?@NW]+\\\\s*$');
      const match = user.match(mapBlockRe);
      if (match) {
        const block = match[1].trim().split('\\n').filter((l) => tileRowRe.test(l)).join('\\n');
        if (block) return block;
      }
      const lines = user.split('\\n');
      const start = lines.findIndex((l) => tileRowRe.test(l));
      if (start >= 0) {
        const end = lines.slice(start).findIndex((l) => !tileRowRe.test(l));
        const slice = end >= 0 ? lines.slice(start, start + end) : lines.slice(start);
        return slice.join('\\n');
      }
      return null;
    }

    function mapCellClass(char) {
      if (char === '@') return 'player';
      if (char === '#') return 'wall';
      if (char === '.') return 'walk';
      if (char === '"') return 'grass';
      if (char === 'N') return 'npc';
      if (char === 'W') return 'warp';
      return 'unknown';
    }

    function renderAsciiMap(mapAscii) {
      const rows = mapAscii.split('\\n').filter((line) => /^\\s*\\d+\\s+[.#"?@NW]+\\s*$/.test(line));
      if (rows.length === 0) return '<pre class="mono-block">' + escapeHtml(mapAscii) + '</pre>';
      const cells = rows.map((line) => {
        const m = line.match(/^\\s*\\d+\\s+([.#"?@NW]+)\\s*$/);
        return m ? m[1].split('') : [];
      });
      const maxCols = Math.max(...cells.map((r) => r.length));
      const grid = document.createElement('div');
      grid.className = 'map-grid';
      grid.style.gridTemplateColumns = 'repeat(' + maxCols + ', 16px)';
      for (const row of cells) {
        for (let c = 0; c < maxCols; c++) {
          const cell = document.createElement('div');
          cell.className = 'map-cell ' + mapCellClass(row[c]);
          cell.textContent = row[c] ?? ' ';
          grid.appendChild(cell);
        }
      }
      const legend = document.createElement('div');
      legend.className = 'map-legend';
      const legendItems = [
        ['player', '@ 플레이어'],
        ['wall', '# 벽'],
        ['walk', '. 이동가능'],
        ['grass', '" 풀'],
        ['npc', 'N NPC'],
        ['warp', 'W 워프'],
        ['unknown', '? 미확인']
      ];
      for (const item of legendItems) {
        const span = document.createElement('span');
        span.innerHTML = '<span class="swatch ' + item[0] + '"></span>' + escapeHtml(item[1]);
        legend.appendChild(span);
      }
      const wrap = document.createElement('div');
      wrap.appendChild(grid);
      wrap.appendChild(legend);
      return wrap.outerHTML;
    }

    function summarizeAction(conversation) {
      const decision = conversation.parsedDecision;
      const cmd = decision?.command;
      const action = decision?.action;
      if (cmd) {
        if (cmd.type === 'navigate') return 'navigate(' + value(cmd.x) + ',' + value(cmd.y) + ')';
        if (cmd.type === 'interact') return 'interact(' + value(cmd.direction, '현재') + ')';
        if (cmd.type === 'wait') return '대기 ' + value(cmd.frames) + 'f';
        if (cmd.type === 'raw') return 'raw [' + (cmd.inputs ?? []).join(',') + ']';
        return cmd.type;
      }
      if (action) {
        if (action.type === 'wait') return '대기 ' + action.frames;
        if (action.type === 'sequence') {
          return '시퀀스 (' + (action.actions ?? []).map((c) => summarizeAction({parsedDecision:{action:c}})).join(' → ') + ')';
        }
        return action.type + ' ' + action.button + ' ' + action.frames;
      }
      return conversation.error ? '오류' : '대기 중';
    }

    function conversationStatus(conversation) {
      if (conversation.error) return '오류 ' + conversation.error.code;
      if (conversation.parsedDecision) return '판단 완료';
      return '대기 중';
    }

    function formatDecision(decision) {
      const parts = ['행동: ' + summarizeAction({ parsedDecision: decision })];
      if (decision.confidence !== undefined) parts.push('확신도: ' + decision.confidence);
      parts.push('근거: ' + decision.rationale);
      const citations = decision.observedStateCitations ?? [];
      if (citations.length > 0) parts.push('근거 출처: ' + citations.join(', '));
      return parts.join('\\n');
    }

    function escapeHtml(input) {
      return String(input)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    }

    async function tick() {
      await Promise.allSettled([
        refreshLiveFrame(),
        refreshLlmConversation(),
        refreshGameState(),
        refreshEvents(),
        refreshRunSummary()
      ]);
      setRefreshLabel();
    }

    setInterval(tick, 1000);
    tick();
  </script>
</body>
</html>`;
}

async function listLatestLlmConversations(directory: string, limit: number): Promise<Array<Record<string, unknown>>> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && /^\d{6}\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, limit);

  const conversations: Array<Record<string, unknown>> = [];
  for (const fileName of files) {
    const filePath = path.join(directory, fileName);
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
      const sanitized = sanitizeConversationForDashboard(parsed);
      conversations.push({
        ...(isRecord(sanitized) ? sanitized : {}),
        fileName
      });
    } catch {
      conversations.push({ fileName, error: "failed to read conversation artifact" });
    }
  }
  return conversations;
}

async function listLatestGameStates(directory: string, limit: number): Promise<Array<Record<string, unknown>>> {
  const fileNames = await listLatestJsonFileNames(directory, limit);
  const states: Array<Record<string, unknown>> = [];
  for (const fileName of fileNames) {
    try {
      const parsed = JSON.parse(await readFile(path.join(directory, fileName), "utf8")) as unknown;
      states.push({
        fileName,
        ...(isRecord(parsed) ? sanitizeConversationForDashboard(parsed) as Record<string, unknown> : { state: parsed })
      });
    } catch {
      states.push({ fileName, error: "failed to read state artifact" });
    }
  }
  return states;
}

async function listLatestRawScreenshots(directory: string, limit: number): Promise<Array<Record<string, unknown>>> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && isSafeRawScreenshotFileName(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, limit);

  const screenshots: Array<Record<string, unknown>> = [];
  for (const fileName of candidates) {
    const fileStat = await stat(path.join(directory, fileName));
    screenshots.push({
      fileName,
      url: `/raw-screenshots/${encodeURIComponent(fileName)}`,
      bytes: fileStat.size,
      mtime: fileStat.mtime.toISOString(),
      step: parseRawScreenshotStep(fileName),
    });
  }
  return screenshots;
}

async function listLatestJsonFileNames(directory: string, limit: number): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && /^\d{6}\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, limit);
}

async function listLatestEvents(file: string, limit: number): Promise<Array<Record<string, unknown>>> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }

  const lines = content.trim().length === 0 ? [] : content.trim().split("\n");
  const events: Array<Record<string, unknown>> = [];
  for (const line of lines.slice(-limit).reverse()) {
    try {
      const parsed = JSON.parse(line) as unknown;
      const sanitized = sanitizeConversationForDashboard(parsed);
      if (isRecord(sanitized)) {
        events.push(sanitized);
      }
    } catch {
      events.push({ type: "invalid_event", payload: { message: "failed to parse event" } });
    }
  }

  return events;
}

async function readRunSummary(summaryFile: string, runId: string): Promise<Record<string, unknown>> {
  const summary = await readJsonRecord(summaryFile);
  const result = isRecord(summary?.result) ? summary.result : undefined;

  return {
    runId,
    status: stringField(summary?.status) ?? stringField(result?.status) ?? "running",
    startedAt: stringField(summary?.startedAt),
    finishedAt: stringField(summary?.finishedAt),
    totalSteps: numberField(result?.totalSteps),
    finalFrame: numberField(result?.finalFrame),
    counts: isRecord(summary?.counts) ? summary.counts : undefined,
    detectorStatus: isRecord(result?.detector) ? {
      status: stringField(result.detector.status),
      progressStep: numberField(result.detector.progressStep),
      lastProgressStep: numberField(result.detector.lastProgressStep),
    } : undefined,
    lastAction: summarizeLastAction(result?.last20Actions),
  };
}

async function readJsonRecord(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    const sanitized = sanitizeConversationForDashboard(parsed);
    return isRecord(sanitized) ? sanitized : undefined;
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function summarizeLastAction(value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const last = value[value.length - 1];
  if (!isRecord(last)) return undefined;
  return {
    step: numberField(last.step),
    frame: numberField(last.frame),
    action: last.action,
    confidence: numberField(last.confidence),
    rationale: stringField(last.rationale),
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isSafeRawScreenshotFileName(fileName: string): boolean {
  return /^\d{6}\.png$/i.test(fileName) &&
    !fileName.includes("/") &&
    !fileName.includes("\\");
}

function parseRawScreenshotStep(fileName: string): number | null {
  const match = fileName.match(/^(\d{6})\.png$/i);
  return match ? Number(match[1]) : null;
}

function sanitizeConversationForDashboard(value: unknown): unknown {
  if (typeof value === "string") {
    return isInlineImageDataUrl(value) ? "[image input omitted from dashboard log]" : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeConversationForDashboard(entry));
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [
        key,
        key === "image_url" ? sanitizeImageUrlObject(entry) : sanitizeConversationForDashboard(entry)
      ])
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeImageUrlObject(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return sanitizeConversationForDashboard(value);
  }

  const record = value as Record<string, unknown>;
  return {
    ...Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [
        key,
        key === "url" && typeof entry === "string" && isInlineImageDataUrl(entry)
          ? "[image input omitted from dashboard log]"
          : sanitizeConversationForDashboard(entry)
      ])
    )
  };
}

function isInlineImageDataUrl(value: string): boolean {
  return /^data:image\//i.test(value) || /;base64,/i.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function readVisionFile(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
