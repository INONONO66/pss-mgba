import http, { type Server } from "node:http";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
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
        const conversations = await listLatestLlmConversations(paths.llmConversationsDir, 3);
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ runId: options.runId, count: conversations.length, conversations }));
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
        const summary = await readRunSummary(paths.summaryFile, paths.eventsFile, options.runId);
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
  <title>Pokemon Harness Dev Viewer</title>
  <style>
    :root {
      --color-page: #0c0c0a;
      --color-surface: #050504;
      --color-line: #34342f;
      --color-text: #f2f0e8;
      --color-muted: #b9b4a7;
      --color-overlay: rgba(5, 5, 4, 0.76);
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 20px;
      --font-ui: "Avenir Next", "Segoe UI", sans-serif;
      --text-label: 12px;
      --text-title: 18px;
      --line-thin: 1px solid var(--color-line);
    }
    html, body { margin: 0; min-height: 100%; background: var(--color-page); color: var(--color-text); font-family: var(--font-ui); }
    body { box-sizing: border-box; min-height: 100vh; padding: clamp(var(--space-3), 3vw, var(--space-5)); display: grid; align-items: start; }
    main { width: min(100%, 1440px); margin: 0 auto; }
    h1, h2 { margin: 0; font-size: var(--text-title); font-weight: 600; letter-spacing: -0.02em; }
    p { margin: var(--space-2) 0 0; color: var(--color-muted); font-size: var(--text-label); line-height: 1.35; }
    code { color: var(--color-text); font-family: inherit; }
    .summary-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); margin-bottom: var(--space-3); }
    .summary-card { border: var(--line-thin); background: var(--color-surface); padding: var(--space-3); min-height: 68px; }
    .summary-label { color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; }
    .summary-value { margin-top: 6px; color: var(--color-text); font-size: 14px; line-height: 1.3; word-break: break-word; }
    .layout { display: grid; grid-template-columns: minmax(320px, 2fr) minmax(220px, 1fr); gap: var(--space-3); align-items: stretch; }
    .conversation-panel { margin-top: var(--space-3); border: var(--line-thin); background: var(--color-surface); min-height: 340px; max-height: 58vh; display: grid; grid-template-columns: 220px minmax(0, 1fr); overflow: hidden; }
    .event-panel { margin-top: var(--space-3); border: var(--line-thin); background: var(--color-surface); max-height: 260px; overflow: auto; }
    .event-list { margin: 0; padding: var(--space-3); display: grid; gap: var(--space-2); }
    .event-item { border: var(--line-thin); background: #10100d; padding: 10px 12px; color: var(--color-muted); font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
    .conversation-header { padding: var(--space-3); background: var(--color-overlay); border-bottom: var(--line-thin); }
    .conversation-main { min-width: 0; overflow: auto; }
    .conversation-body { margin: 0; padding: var(--space-3); white-space: pre-wrap; word-break: break-word; color: var(--color-muted); font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .history-rail { border-right: var(--line-thin); overflow: auto; }
    .history-button { width: 100%; display: block; padding: 10px 12px; border: 0; border-bottom: var(--line-thin); background: transparent; color: var(--color-muted); text-align: left; font: 12px/1.3 var(--font-ui); cursor: pointer; }
    .history-button:hover, .history-button.active { background: #151510; color: var(--color-text); }
    .decision-card { color: var(--color-text); border: var(--line-thin); padding: var(--space-3); margin-bottom: var(--space-3); background: #10100d; }
    .image-cell, .vision-wall { position: relative; overflow: hidden; background: var(--color-surface); border: var(--line-thin); }
    .image-cell { aspect-ratio: 1 / 1; }
    #live-frame { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; background: var(--color-surface); }
    .overlay { position: absolute; left: 0; right: 0; z-index: 1; padding: var(--space-3); background: linear-gradient(180deg, var(--color-overlay), rgba(5, 5, 4, 0)); pointer-events: none; }
    .overlay-top { top: 0; }
    .overlay-bottom { bottom: 0; background: linear-gradient(0deg, var(--color-overlay), rgba(5, 5, 4, 0)); }
    .vision-wall { aspect-ratio: 1 / 2; }
    .vision-grid { display: grid; grid-template-columns: 1fr; grid-template-rows: repeat(3, minmax(0, 1fr)); height: 100%; }
    .vision-cell { position: relative; min-height: 0; aspect-ratio: 1 / 1; border-top: var(--line-thin); }
    .vision-cell:first-child { border-top: 0; }
    .vision-cell img { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; background: var(--color-surface); }
    .meta { color: var(--color-muted); font-size: var(--text-label); line-height: 1.4; word-break: break-word; }
    .empty { box-sizing: border-box; display: grid; grid-column: 1 / -1; grid-row: 1 / -1; height: 100%; place-items: center; padding: var(--space-5); color: var(--color-muted); font-size: var(--text-label); text-align: center; }
    @media (max-width: 800px) { .summary-strip, .layout { grid-template-columns: 1fr; } .vision-wall { aspect-ratio: 3 / 1; } .vision-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: 1fr; } .vision-cell { border-top: 0; border-left: var(--line-thin); } .vision-cell:first-child { border-left: 0; } .conversation-panel { grid-template-columns: 1fr; max-height: none; } .history-rail { border-right: 0; border-bottom: var(--line-thin); max-height: 130px; } }
  </style>
</head>
<body>
  <main>
    <section class="summary-strip" aria-label="Run summary">
      <article class="summary-card"><div class="summary-label">Run</div><div id="summary-run" class="summary-value">${escapeHtml(runId)}</div></article>
      <article class="summary-card"><div class="summary-label">Status</div><div id="summary-status" class="summary-value">Loading...</div></article>
      <article class="summary-card"><div class="summary-label">Progress</div><div id="summary-progress" class="summary-value">Waiting...</div></article>
      <article class="summary-card"><div class="summary-label">Supervisor</div><div id="summary-supervisor" class="summary-value">Waiting...</div></article>
    </section>
    <div class="layout">
      <section class="image-cell">
        <div class="overlay overlay-top">
          <h1>Main game screen</h1>
          <p>Live mGBA screenshot | run <code>${escapeHtml(runId)}</code></p>
        </div>
        <img id="live-frame" src="/api/live-frame" alt="Live mGBA screen">
      </section>
      <section class="vision-wall">
        <div class="overlay overlay-top">
          <h2>LLM context images</h2>
          <p id="vision-status">Loading latest ${visionImageLimit} processed input(s)...</p>
        </div>
        <div id="vision-grid" class="vision-grid"></div>
      </section>
    </div>
    <section class="conversation-panel">
      <div class="history-rail">
        <div class="conversation-header">
          <h2>LLM history</h2>
          <p id="llm-status">Waiting...</p>
        </div>
        <div id="llm-history"></div>
      </div>
      <div class="conversation-main">
        <div class="conversation-header">
          <h2>LLM context + decision</h2>
          <p>Stored in <code>${escapeHtml(llmConversationsPath)}</code></p>
        </div>
        <pre id="llm-conversation" class="conversation-body">No LLM conversation recorded yet.</pre>
      </div>
    </section>
    <section class="event-panel">
      <div class="conversation-header">
        <h2>Run events</h2>
        <p id="event-status">Waiting...</p>
      </div>
      <div id="event-list" class="event-list"></div>
    </section>
  </main>
  <script>
    const liveFrame = document.getElementById('live-frame');
    const visionGrid = document.getElementById('vision-grid');
    const visionStatus = document.getElementById('vision-status');
    const llmStatus = document.getElementById('llm-status');
    const llmConversation = document.getElementById('llm-conversation');
    const llmHistory = document.getElementById('llm-history');
    const eventStatus = document.getElementById('event-status');
    const eventList = document.getElementById('event-list');
    const summaryStatus = document.getElementById('summary-status');
    const summaryProgress = document.getElementById('summary-progress');
    const summarySupervisor = document.getElementById('summary-supervisor');
    let selectedConversationFile = null;

    function text(node, value) { node.appendChild(document.createTextNode(value)); }

    async function refreshLiveFrame() {
      liveFrame.src = '/api/live-frame?nonce=' + Date.now();
    }

    async function refreshVisionImages() {
      const payload = await fetch('/api/vision-images', { cache: 'no-store' }).then((response) => response.json());
      visionStatus.textContent = payload.count + '/' + payload.limit + ' processed image(s) currently available to LLM context';
      visionGrid.textContent = '';
      if (!payload.images || payload.images.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No processed LLM context images yet. They appear after the first --vision runner snapshot.';
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
        meta.className = 'overlay overlay-bottom meta';
        text(meta, image.fileName);
        meta.appendChild(document.createElement('br'));
        text(meta, 'step ' + (image.step ?? '?') + ' | frame ' + (image.frame ?? '?') + ' | ' + image.bytes + ' bytes');
        card.appendChild(meta);
        visionGrid.appendChild(card);
      }
    }

    async function refreshLlmConversation() {
      const payload = await fetch('/api/llm-conversations', { cache: 'no-store' }).then((response) => response.json());
      if (!payload.conversations || payload.conversations.length === 0) {
        llmStatus.textContent = 'No LLM request recorded yet';
        llmHistory.textContent = '';
        llmConversation.textContent = 'No LLM conversation recorded yet.';
        return;
      }
      if (!selectedConversationFile || !payload.conversations.some((item) => item.fileName === selectedConversationFile)) {
        selectedConversationFile = payload.conversations[0].fileName;
      }
      llmHistory.textContent = '';
      for (const conversation of payload.conversations) {
        const button = document.createElement('button');
        button.className = 'history-button' + (conversation.fileName === selectedConversationFile ? ' active' : '');
        button.textContent = conversation.fileName + '\\ncall ' + (conversation.call ?? '?') + ' · ' + summarizeAction(conversation);
        button.onclick = () => { selectedConversationFile = conversation.fileName; llmConversation.textContent = formatConversation(conversation); };
        llmHistory.appendChild(button);
      }
      const selected = payload.conversations.find((item) => item.fileName === selectedConversationFile) ?? payload.conversations[0];
      llmStatus.textContent = payload.count + ' stored · latest ' + payload.conversations[0].fileName;
      llmConversation.textContent = formatConversation(selected);
    }

    async function refreshEvents() {
      const payload = await fetch('/api/events?limit=20', { cache: 'no-store' }).then((response) => response.json());
      eventStatus.textContent = payload.count + '/' + payload.limit + ' latest event(s)';
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
      const counts = summary.counts ?? {};
      summaryProgress.textContent = 'steps ' + (summary.totalSteps ?? '?') + ' · decisions ' + (counts.decisions ?? 0) + ' · errors ' + (counts.errors ?? 0);
      const supervisor = summary.latestSupervisor;
      summarySupervisor.textContent = supervisor?.activeGoal?.title
        ? supervisor.activeGoal.title + ' · ' + (supervisor.state ?? 'unknown')
        : 'No supervisor decision yet';
    }

    function formatEvent(event) {
      const header = '[' + (event.sequence ?? '-') + '] ' + event.type + ' · ' + event.timestamp;
      const supervisor = event.payload?.supervisor;
      if (supervisor !== undefined) {
        return [
          header,
          'goal: ' + (supervisor.activeGoal?.title ?? '?') + ' (' + (supervisor.activeGoal?.kind ?? '?') + ')',
          'state: ' + (supervisor.state ?? '?'),
          'guidance: ' + ((supervisor.guidance ?? []).join(' | ') || '?')
        ].join('\\n');
      }
      return header + '\\n' + JSON.stringify(event.payload ?? {}, null, 2);
    }

    function formatConversation(conversation) {
      const sections = [];
      sections.push('MODEL: ' + (conversation.model ?? '?') + ' | MODE: ' + (conversation.harnessMode ?? '?'));
      if (conversation.parsedDecision !== undefined) {
        sections.push('\\n[DECISION]');
        sections.push(formatDecision(conversation.parsedDecision));
      }
      if (conversation.error !== undefined) {
        sections.push('\\n[ERROR]');
        sections.push(JSON.stringify(conversation.error, null, 2));
      }
      if (conversation.responseContent !== undefined) {
        sections.push('\\n[RAW RESPONSE]');
        sections.push(conversation.responseContent);
      }
      sections.push('\\n[PROMPT / CONTEXT]');
      for (const message of conversation.messages ?? []) {
        sections.push('\\n[' + String(message.role).toUpperCase() + ']');
        if (typeof message.content === 'string') {
          sections.push(message.content);
        } else {
          for (const part of message.content ?? []) {
            if (part.type === 'text') sections.push(part.text);
            if (part.type === 'image_url') {
              const detail = part.image_url?.detail ? ' detail=' + part.image_url.detail : '';
              sections.push('[image input omitted from dashboard log' + detail + ']');
            }
          }
        }
      }
      return sections.join('\\n');
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

    function formatDecision(decision) {
      return [
        'action: ' + summarizeAction({ parsedDecision: decision }),
        'confidence: ' + decision.confidence,
        'rationale: ' + decision.rationale,
        'citations: ' + (decision.observedStateCitations ?? []).join(', ')
      ].join('\\n');
    }

    async function tick() {
      await Promise.allSettled([refreshLiveFrame(), refreshVisionImages(), refreshLlmConversation(), refreshEvents(), refreshRunSummary()]);
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

async function readRunSummary(summaryFile: string, eventsFile: string, runId: string): Promise<Record<string, unknown>> {
  const [summary, latestEvents] = await Promise.all([
    readJsonRecord(summaryFile),
    listLatestEvents(eventsFile, 20),
  ]);
  const result = isRecord(summary?.result) ? summary.result : undefined;
  const latestSupervisor = latestEvents
    .map((event) => isRecord(event.payload) ? event.payload.supervisor : undefined)
    .find(isRecord);

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
    latestSupervisor,
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
