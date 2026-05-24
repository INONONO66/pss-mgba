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

function renderPage(runId: string, visionImageLimit: number, llmConversationsPath: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pokemon Harness Dev Viewer</title>
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
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      min-width: 1180px;
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
      height: 100vh;
      padding: 12px;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 10px;
    }
    .topbar {
      display: grid;
      grid-template-columns: minmax(260px, 1.1fr) repeat(6, minmax(135px, 0.7fr));
      gap: 8px;
    }
    .card, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
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
      grid-template-columns: minmax(456px, 1.16fr) minmax(360px, 0.92fr) minmax(470px, 1fr);
      grid-template-rows: minmax(0, 1.08fr) minmax(0, 0.92fr);
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
    .history-panel { grid-row: 2; grid-column: 1; }
    .context-panel { grid-row: 2; grid-column: 2; }
    .scroll { min-height: 0; overflow: auto; }
    .state-body, .context-body, .event-list, .history-grid, .vision-grid, .llm-detail { padding: 10px; }
    .state-block { display: grid; gap: 8px; }
    .kv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .kv { padding: 9px; background: var(--panel-soft); border: 1px solid rgba(196, 255, 166, 0.12); }
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
    .history-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
    .raw-shot { min-width: 0; background: var(--panel-soft); border: 1px solid rgba(196, 255, 166, 0.12); }
    .raw-shot img { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: contain; image-rendering: pixelated; background: #020302; }
    .raw-shot .meta { padding: 6px; color: var(--muted); font: 10px/1.28 var(--mono); overflow-wrap: anywhere; }
    .context-tabs, .llm-tabs { display: flex; gap: 6px; padding: 8px 10px 0; background: rgba(7, 11, 8, 0.35); }
    .tab {
      padding: 6px 8px;
      color: var(--muted);
      cursor: pointer;
      background: rgba(0,0,0,0.22);
      border: 1px solid rgba(196, 255, 166, 0.12);
      border-bottom-color: var(--line);
      font: 700 10px/1 var(--mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
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
    }
    .history-button:hover, .history-button.active { color: var(--ink); background: rgba(140, 255, 113, 0.08); }
    .decision-card { display: grid; gap: 8px; margin-bottom: 10px; padding: 10px; color: var(--ink); background: rgba(140,255,113,0.08); border: 1px solid var(--line-strong); }
    .vision-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .vision-cell { position: relative; min-width: 0; background: var(--panel-soft); border: 1px solid rgba(196, 255, 166, 0.12); }
    .vision-cell img { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: contain; image-rendering: pixelated; background: #020302; }
    .vision-cell .meta { position: absolute; left: 0; right: 0; bottom: 0; padding: 6px; color: var(--muted); font: 10px/1.25 var(--mono); background: rgba(7,11,8,0.78); overflow-wrap: anywhere; }
    .event-list { display: grid; gap: 8px; }
    .event-item { padding: 9px; color: var(--muted); background: var(--panel-soft); border: 1px solid rgba(196, 255, 166, 0.12); font: 10px/1.35 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .empty { display: grid; min-height: 100%; place-items: center; padding: 18px; color: var(--muted-2); text-align: center; font: 12px/1.4 var(--mono); }
    @media (max-width: 1250px) {
      body { min-width: 0; overflow: auto; }
      html, body { height: auto; }
      .shell { min-height: 100vh; height: auto; }
      .topbar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; grid-template-rows: repeat(6, minmax(320px, auto)); }
      .screen-panel, .state-panel, .llm-panel, .history-panel, .context-panel { grid-row: auto; grid-column: auto; }
      .llm-layout { grid-template-columns: 1fr; }
      .llm-rail { max-height: 160px; border-right: 0; border-bottom: 1px solid var(--line); }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="topbar" aria-label="Run summary">
      <article class="card"><div class="label">Run</div><div id="summary-run" class="value">${escapeHtml(runId)}</div></article>
      <article class="card"><div class="label">Status</div><div id="summary-status" class="value muted">Loading...</div></article>
      <article class="card"><div class="label">Progress</div><div id="summary-progress" class="value muted">Waiting...</div></article>
      <article class="card"><div class="label">Map</div><div id="summary-map" class="value muted">Waiting...</div></article>
      <article class="card"><div class="label">Party</div><div id="summary-party" class="value muted">Waiting...</div></article>
      <article class="card"><div class="label">Player action</div><div id="summary-player" class="value muted">Waiting...</div></article>
      <article class="card"><div class="label">Refresh</div><div id="summary-refresh" class="value muted">Starting...</div></article>
    </section>

    <section class="grid" aria-label="Live observability dashboard">
      <article class="panel screen-panel">
        <div class="panel-header"><h1>Live game screen</h1><p>mGBA frame · <code>${escapeHtml(runId)}</code></p></div>
        <div class="screen-wrap">
          <img id="live-frame" src="/api/live-frame" alt="Live mGBA screen">
          <div class="screen-hud">
            <div id="screen-location" class="status-line"><span class="chip">waiting for state</span></div>
            <div id="screen-dialog" class="muted">Dialog/text will appear here.</div>
          </div>
        </div>
      </article>

      <article class="panel state-panel">
        <div class="panel-header"><h2>Current state</h2><p id="state-status">Waiting for RAM snapshots...</p></div>
        <div class="state-body scroll">
          <div id="state-pretty" class="state-block"></div>
          <pre id="game-state" class="mono-block" style="margin-top:10px">No game state recorded yet.</pre>
        </div>
      </article>

      <article class="panel llm-panel">
        <div class="panel-header"><h2>LLM prompt + decision</h2><p id="llm-status">Waiting...</p></div>
        <div class="llm-layout">
          <div class="llm-rail"><div id="llm-history"></div></div>
          <div class="panel" style="border:0; box-shadow:none; background:transparent">
            <div class="llm-tabs">
              <button class="tab active" data-llm-tab="overview">Decision</button>
              <button class="tab" data-llm-tab="system">System</button>
              <button class="tab" data-llm-tab="state">State</button>
              <button class="tab" data-llm-tab="user">Injected</button>
              <button class="tab" data-llm-tab="raw">Raw</button>
            </div>
            <div class="llm-detail scroll"><div id="llm-conversation" class="pretty-text">No LLM conversation recorded yet.</div></div>
          </div>
        </div>
      </article>

      <article class="panel history-panel">
        <div class="panel-header"><h2>Screen history</h2><p id="screenshot-status">Waiting for raw screenshots...</p></div>
        <div id="screenshot-grid" class="history-grid scroll"></div>
      </article>

      <article class="panel context-panel">
        <div class="panel-header"><h2>Input context images + event log</h2><p id="vision-status">Loading latest ${visionImageLimit} processed input(s)...</p></div>
        <div class="context-tabs">
          <button class="tab active" data-context-tab="vision">Images</button>
          <button class="tab" data-context-tab="events">Events</button>
        </div>
        <div class="context-body scroll">
          <div id="vision-grid" class="vision-grid"></div>
          <div id="event-list" class="event-list" hidden></div>
        </div>
      </article>
    </section>
  </main>
  <script>
    const liveFrame = document.getElementById('live-frame');
    const visionGrid = document.getElementById('vision-grid');
    const visionStatus = document.getElementById('vision-status');
    const llmStatus = document.getElementById('llm-status');
    const llmConversation = document.getElementById('llm-conversation');
    const llmHistory = document.getElementById('llm-history');
    const eventList = document.getElementById('event-list');
    const stateStatus = document.getElementById('state-status');
    const statePretty = document.getElementById('state-pretty');
    const gameState = document.getElementById('game-state');
    const screenshotStatus = document.getElementById('screenshot-status');
    const screenshotGrid = document.getElementById('screenshot-grid');
    const summaryStatus = document.getElementById('summary-status');
    const summaryProgress = document.getElementById('summary-progress');
    const summaryMap = document.getElementById('summary-map');
    const summaryParty = document.getElementById('summary-party');
    const summaryPlayer = document.getElementById('summary-player');
    const summaryRefresh = document.getElementById('summary-refresh');
    const screenLocation = document.getElementById('screen-location');
    const screenDialog = document.getElementById('screen-dialog');
    let selectedConversationFile = null;
    let selectedLlmTab = 'overview';
    let selectedContextTab = 'vision';
    let latestConversation = null;

    function text(node, value) { node.appendChild(document.createTextNode(value)); }
    function value(value, fallback = '?') { return value === undefined || value === null || value === '' ? fallback : String(value); }
    function boolText(value) { return value ? 'yes' : 'no'; }
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
        visionGrid.hidden = selectedContextTab !== 'vision';
        eventList.hidden = selectedContextTab !== 'events';
      });
    }

    async function refreshLiveFrame() {
      liveFrame.src = '/api/live-frame?nonce=' + Date.now();
    }

    async function refreshVisionImages() {
      const payload = await fetch('/api/vision-images', { cache: 'no-store' }).then((response) => response.json());
      visionStatus.textContent = payload.count + '/' + payload.limit + ' image(s) sent as visual context';
      visionGrid.textContent = '';
      if (!payload.images || payload.images.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No processed visual inputs yet. They appear after the first vision snapshot.';
        visionGrid.appendChild(empty);
        return;
      }

      for (const image of payload.images) {
        const card = document.createElement('article');
        card.className = 'vision-cell';
        const img = document.createElement('img');
        img.src = image.url;
        img.alt = 'LLM context image ' + image.fileName;
        card.appendChild(img);
        const meta = document.createElement('div');
        meta.className = 'meta';
        text(meta, image.fileName + '\\nstep ' + value(image.step) + ' · frame ' + value(image.frame));
        card.appendChild(meta);
        visionGrid.appendChild(card);
      }
    }

    async function refreshLlmConversation() {
      const payload = await fetch('/api/llm-conversations?limit=20', { cache: 'no-store' }).then((response) => response.json());
      if (!payload.conversations || payload.conversations.length === 0) {
        llmStatus.textContent = 'No LLM request recorded yet';
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
        button.textContent = conversation.fileName + '\\ncall ' + value(conversation.call) + ' · ' + summarizeAction(conversation) + '\\n' + conversationStatus(conversation);
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
      llmStatus.textContent = payload.count + ' stored · latest ' + payload.conversations[0].fileName + ' · ' + conversationStatus(payload.conversations[0]);
      renderSelectedConversation();
    }

    async function refreshGameState() {
      const payload = await fetch('/api/game-state?limit=8', { cache: 'no-store' }).then((response) => response.json());
      if (!payload.latest) {
        stateStatus.textContent = 'No game state snapshot recorded yet';
        statePretty.textContent = '';
        gameState.textContent = 'No game state recorded yet.';
        summaryMap.textContent = 'No state';
        summaryParty.textContent = 'No state';
        screenLocation.textContent = '';
        const chip = document.createElement('span');
        chip.className = 'chip warn';
        chip.textContent = 'waiting for state';
        screenLocation.appendChild(chip);
        screenDialog.textContent = 'Dialog/text will appear here.';
        return;
      }
      const latest = payload.latest;
      const state = unwrapState(latest);
      stateStatus.textContent = payload.count + '/' + payload.limit + ' snapshot(s) · latest ' + latest.fileName;
      gameState.textContent = formatStateSnapshot(latest);
      renderPrettyState(latest, state);
      updateStateCards(latest, state);
    }

    async function refreshScreenshotHistory() {
      const payload = await fetch('/api/screenshots?limit=12', { cache: 'no-store' }).then((response) => response.json());
      screenshotStatus.textContent = payload.count + '/' + payload.limit + ' raw screenshot(s)';
      screenshotGrid.textContent = '';
      if (!payload.screenshots || payload.screenshots.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No raw game screenshots recorded yet.';
        screenshotGrid.appendChild(empty);
        return;
      }

      for (const screenshot of payload.screenshots) {
        const card = document.createElement('article');
        card.className = 'raw-shot';
        const img = document.createElement('img');
        img.src = screenshot.url;
        img.alt = 'Raw game screenshot ' + screenshot.fileName;
        card.appendChild(img);
        const meta = document.createElement('div');
        meta.className = 'meta';
        text(meta, screenshot.fileName + '\\nstep ' + value(screenshot.step));
        card.appendChild(meta);
        screenshotGrid.appendChild(card);
      }
    }

    async function refreshEvents() {
      const payload = await fetch('/api/events?limit=80', { cache: 'no-store' }).then((response) => response.json());
      eventList.textContent = '';
      if (!payload.events || payload.events.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No run events recorded yet.';
        eventList.appendChild(empty);
        return;
      }
      for (const event of payload.events) {
        const item = document.createElement('article');
        item.className = 'event-item';
        item.textContent = formatEvent(event);
        eventList.appendChild(item);
      }
    }

    async function refreshRunSummary() {
      const summary = await fetch('/api/run-summary', { cache: 'no-store' }).then((response) => response.json());
      summaryStatus.textContent = summary.status ?? 'unknown';
      summaryStatus.className = 'value ' + ((summary.status ?? '').startsWith('failed') ? 'bad' : '');
      const counts = summary.counts ?? {};
      summaryProgress.textContent = 'steps ' + value(summary.totalSteps) + ' · decisions ' + (counts.decisions ?? 0) + ' · errors ' + (counts.errors ?? 0);
      summaryPlayer.textContent = summary.lastAction
        ? summarizeAction({ parsedDecision: { action: summary.lastAction.action } }) + ' · ' + (summary.lastAction.rationale ?? 'no rationale')
        : 'No player action yet';
    }

    function renderPrettyState(snapshot, state) {
      statePretty.textContent = '';
      const block = document.createElement('div');
      block.className = 'kv-grid';
      const entries = stateEntries(snapshot, state);
      for (const entry of entries) {
        const item = document.createElement('div');
        item.className = 'kv';
        const label = document.createElement('b');
        label.textContent = entry[0];
        const span = document.createElement('span');
        span.textContent = entry[1];
        item.appendChild(label);
        item.appendChild(span);
        block.appendChild(item);
      }
      statePretty.appendChild(block);
      const dialog = dialogText(state);
      if (dialog) {
        const pre = document.createElement('pre');
        pre.className = 'mono-block';
        pre.textContent = 'Dialog/text\\n' + dialog;
        statePretty.appendChild(pre);
      }
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
      summaryMap.textContent = (mapName ? mapName + ' ' : '') + 'map ' + value(mapId) + ' · y' + value(y) + ' x' + value(x);
      summaryParty.textContent = lead
        ? partyCount + '/6 · ' + lead.nickname + ' Lv' + lead.level + ' HP ' + lead.hp + '/' + lead.maxHp
        : value(partyCount, 0) + '/6 · lead HP ' + value(hp.current ?? state?.wPartyMon1HP) + '/' + value(hp.max ?? state?.wPartyMon1MaxHP);
      screenLocation.textContent = '';
      for (const chip of [
        'map ' + value(mapId),
        'y' + value(y) + ' x' + value(x),
        'facing ' + value(facing),
        'badges ' + value(badgeCount, 0),
        'battle ' + value(battle)
      ]) {
        const node = document.createElement('span');
        node.className = 'chip';
        node.textContent = chip;
        screenLocation.appendChild(node);
      }
      screenDialog.textContent = dialog || 'No active dialog/text detected.';
    }

    function stateEntries(snapshot, state) {
      const mapId = state?.map?.mapId ?? state?.coordinates?.mapId ?? state?.wCurMap ?? state?.mapId;
      const mapName = state?.map?.mapName;
      const y = state?.player?.position?.y ?? state?.coordinates?.y ?? state?.wYCoord ?? state?.y;
      const x = state?.player?.position?.x ?? state?.coordinates?.x ?? state?.wXCoord ?? state?.x;
      const facing = state?.player?.facing?.direction ?? state?.playerFacing?.direction ?? state?.playerFacingDirection;
      const badges = state?.player?.badges?.names?.join(', ') || state?.badges?.names?.join(', ') || 'none';
      const badgeCount = state?.player?.badges?.count ?? state?.badges?.count ?? state?.badgeCount ?? 0;
      const battleKind = state?.battle?.type ?? state?.battle?.kind ?? state?.battleState?.flag?.kind ?? (state?.wIsInBattle ? 'battle' : 'none');
      const partyCount = state?.party?.count ?? state?.wPartyCount ?? state?.partyCount;
      const hp = state?.party?.firstPokemonHp ?? {};
      const lead = Array.isArray(state?.party?.members) ? state.party.members[0] : undefined;
      const dialog = state?.dialog?.active ?? state?.textActive ?? Boolean(dialogText(state));
      return [
        ['Snapshot', 'step ' + value(snapshot.state?.step ?? snapshot.step) + ' · frame ' + value(snapshot.state?.frame ?? snapshot.frame)],
        ['Location', (mapName ? mapName + ' · ' : '') + 'map ' + value(mapId) + ' · y=' + value(y) + ' x=' + value(x) + ' · ' + value(facing)],
        ['Progress', 'badges ' + badgeCount + ' (' + badges + ') · Hall of Fame ' + boolText(Boolean(state?.hallOfFameComplete))],
        ['Party', lead ? lead.nickname + ' ' + lead.species + ' Lv' + lead.level + ' HP ' + lead.hp + '/' + lead.maxHp : value(partyCount, 0) + '/6 · lead HP ' + value(hp.current ?? state?.wPartyMon1HP) + '/' + value(hp.max ?? state?.wPartyMon1MaxHP)],
        ['Battle', battleKind + (state?.battle?.enemy ? ' · enemy ' + state.battle.enemy.species + ' Lv' + state.battle.enemy.level : '')],
        ['Dialog/menu', 'active ' + boolText(Boolean(dialog)) + ' · textBox ' + value(state?.dialog?.textBoxId ?? state?.textBoxId ?? state?.wTextBoxID) + ' · menu ' + value(state?.menuText?.currentMenuItem ?? state?.menuItem)]
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

    function renderSelectedConversation() {
      if (!latestConversation) {
        llmConversation.textContent = 'No LLM conversation recorded yet.';
        return;
      }
      if (selectedLlmTab === 'overview') llmConversation.innerHTML = formatConversationOverview(latestConversation);
      else llmConversation.textContent = formatConversationTab(latestConversation, selectedLlmTab);
    }

    function formatConversationOverview(conversation) {
      const decision = conversation.parsedDecision;
      const error = conversation.error;
      const lines = [];
      lines.push('<div class="decision-card">');
      lines.push('<div><span class="label">Model</span><div class="value">' + escapeHtml(value(conversation.model)) + ' · call ' + escapeHtml(value(conversation.call)) + ' · ' + escapeHtml(value(conversation.harnessMode)) + '</div></div>');
      if (decision) {
        lines.push('<div><span class="label">Action</span><div class="value">' + escapeHtml(summarizeAction({ parsedDecision: decision })) + '</div></div>');
        lines.push('<div><span class="label">Rationale</span><div class="value muted">' + escapeHtml(value(decision.rationale)) + '</div></div>');
        lines.push('<div><span class="label">Confidence</span><div class="value">' + escapeHtml(value(decision.confidence)) + '</div></div>');
      } else if (error) {
        lines.push('<div><span class="label">Error</span><div class="value bad">' + escapeHtml(error.code + ': ' + error.message) + '</div></div>');
      } else {
        lines.push('<div><span class="label">Status</span><div class="value muted">No parsed decision yet</div></div>');
      }
      lines.push('</div>');
      lines.push('<pre class="mono-block">' + escapeHtml(formatConversationTab(conversation, 'state')) + '</pre>');
      return lines.join('');
    }

    function formatConversationTab(conversation, tab) {
      const messages = conversation.messages ?? [];
      const system = messages.filter((message) => message.role === 'system').map(messageText).join('\\n\\n');
      const user = messages.filter((message) => message.role === 'user').map(messageText).join('\\n\\n');
      if (tab === 'system') return system || 'No system prompt recorded.';
      if (tab === 'state') return extractStateContext(user);
      if (tab === 'user') return user || 'No user prompt recorded.';
      if (tab === 'raw') {
        return [
          '[RAW RESPONSE]', conversation.responseContent ?? 'No raw response recorded.',
          '',
          '[ERROR]', conversation.error ? compactJson(conversation.error) : 'none',
          '',
          '[FULL TRACE]', compactJson(conversation)
        ].join('\\n');
      }
      return formatConversation(conversation);
    }

    function messageText(message) {
      if (typeof message.content === 'string') return message.content;
      const chunks = [];
      for (const part of message.content ?? []) {
        if (part.type === 'text') chunks.push(part.text);
        if (part.type === 'image_url') chunks.push('[image input omitted from dashboard log' + (part.image_url?.detail ? ' detail=' + part.image_url.detail : '') + ']');
      }
      return chunks.join('\\n');
    }

    function extractStateContext(userText) {
      if (!userText) return 'No state context recorded.';
      const start = userText.indexOf('Objective:');
      const fallbackStart = userText.indexOf('Progress:');
      const actualStart = start >= 0 ? start : Math.max(0, fallbackStart);
      const markers = ['Recent actions summary:', 'Current map (ASCII grid', 'Rules:', 'Output schema:'];
      let end = userText.length;
      for (const marker of markers) {
        const index = userText.indexOf(marker, actualStart);
        if (index >= 0) end = Math.min(end, index);
      }
      return userText.slice(actualStart, end).trim() || userText;
    }

    function formatConversation(conversation) {
      const sections = [];
      sections.push('MODEL: ' + value(conversation.model) + ' | MODE: ' + value(conversation.harnessMode) + ' | CALL: ' + value(conversation.call));
      if (conversation.parsedDecision !== undefined) {
        sections.push('\\n[DECISION]');
        sections.push(formatDecision(conversation.parsedDecision));
      }
      if (conversation.error !== undefined && conversation.error !== null) {
        sections.push('\\n[ERROR]');
        sections.push(compactJson(conversation.error));
      }
      if (conversation.responseContent !== undefined) {
        sections.push('\\n[RAW RESPONSE]');
        sections.push(conversation.responseContent);
      }
      sections.push('\\n[PROMPT / INJECTED LLM CONTEXT]');
      for (const message of conversation.messages ?? []) {
        sections.push('\\n[' + String(message.role).toUpperCase() + ']');
        sections.push(messageText(message));
      }
      return sections.join('\\n');
    }

    function formatStateSnapshot(snapshot) {
      const state = unwrapState(snapshot);
      const lines = [
        'file: ' + snapshot.fileName,
        'step: ' + value(snapshot.state?.step ?? snapshot.step),
        'frame: ' + value(snapshot.state?.frame ?? snapshot.frame),
        'stateHash: ' + value(snapshot.state?.stateHash ?? snapshot.stateHash),
        '',
        compactJson(state ?? snapshot)
      ];
      return lines.join('\\n');
    }

    function summarizeAction(conversation) {
      const action = conversation.parsedDecision?.action;
      if (!action) return conversation.error ? 'error' : 'pending';
      if (action.type === 'wait') return 'wait ' + action.frames;
      if (action.type === 'sequence') {
        const childActions = (action.actions ?? []).map((child) => summarizeAction({ parsedDecision: { action: child } }));
        return 'sequence (' + childActions.join(' → ') + ')';
      }
      return action.type + ' ' + action.button + ' ' + action.frames;
    }

    function conversationStatus(conversation) {
      if (conversation.error) return 'error ' + conversation.error.code;
      if (conversation.parsedDecision) return 'decision ok';
      return 'pending';
    }

    function formatDecision(decision) {
      return [
        'action: ' + summarizeAction({ parsedDecision: decision }),
        'confidence: ' + decision.confidence,
        'rationale: ' + decision.rationale,
        'citations: ' + (decision.observedStateCitations ?? []).join(', ')
      ].join('\\n');
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
        refreshVisionImages(),
        refreshLlmConversation(),
        refreshGameState(),
        refreshScreenshotHistory(),
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
