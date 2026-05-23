import http, { type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
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
        response.end(renderPage(options.runId, visionImageLimit));
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

function renderPage(runId: string, visionImageLimit: number): string {
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
      --page-pad: clamp(var(--space-3), 4vw, var(--space-5));
      --gb-screen-aspect: 10 / 9;
      --live-screen-aspect: 1.111111;
      --vision-screen-aspect: 1.111111;
      --viewer-stage-aspect: 1.481481;
      --mobile-stage-aspect: 0.833333;
      --live-column-fr: 1.111111fr;
      --vision-column-fr: 0.37037fr;
      --live-row-fr: 0.9fr;
      --vision-row-fr: 0.3fr;
      --vision-stack-aspect: 0.37037;
      --vision-row-aspect: 3.333333;
    }
    html, body { margin: 0; min-height: 100%; background: var(--color-page); color: var(--color-text); font-family: var(--font-ui); }
    *, *::before, *::after { box-sizing: border-box; }
    body { min-height: 100dvh; padding: var(--page-pad); display: grid; place-items: center; overflow: hidden; }
    main { width: min(calc(100vw - (var(--page-pad) * 2)), calc((100dvh - (var(--page-pad) * 2)) * var(--viewer-stage-aspect))); aspect-ratio: var(--viewer-stage-aspect); margin: 0 auto; }
    h1, h2 { margin: 0; font-size: var(--text-title); font-weight: 600; letter-spacing: -0.02em; }
    p { margin: var(--space-2) 0 0; color: var(--color-muted); font-size: var(--text-label); line-height: 1.35; }
    code { color: var(--color-text); font-family: inherit; }
    .layout { position: relative; display: grid; width: 100%; height: 100%; grid-template-columns: minmax(0, var(--live-column-fr)) minmax(0, var(--vision-column-fr)); gap: 0; align-items: stretch; }
    .layout::before { content: ""; position: absolute; inset: 0; z-index: 3; border: var(--line-thin); pointer-events: none; }
    .image-cell, .vision-wall { position: relative; overflow: hidden; background: var(--color-surface); }
    .image-cell { min-width: 0; height: 100%; aspect-ratio: var(--live-screen-aspect); }
    #live-frame { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; background: var(--color-surface); }
    .overlay { position: absolute; left: 0; right: 0; z-index: 1; padding: var(--space-3); background: linear-gradient(180deg, var(--color-overlay), rgba(5, 5, 4, 0)); pointer-events: none; }
    .overlay-top { top: 0; }
    .overlay-bottom { bottom: 0; background: linear-gradient(0deg, var(--color-overlay), rgba(5, 5, 4, 0)); }
    .vision-wall { min-width: 0; height: 100%; aspect-ratio: var(--vision-stack-aspect); }
    .vision-wall::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; z-index: 3; border-left: var(--line-thin); pointer-events: none; }
    .vision-grid { display: grid; grid-template-columns: 1fr; grid-template-rows: repeat(3, minmax(0, 1fr)); height: 100%; }
    .vision-cell { position: relative; min-height: 0; aspect-ratio: var(--vision-screen-aspect); }
    .vision-cell + .vision-cell::before { content: ""; position: absolute; top: 0; left: 0; right: 0; z-index: 3; border-top: var(--line-thin); pointer-events: none; }
    .vision-cell img { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; background: var(--color-surface); }
    .meta { color: var(--color-muted); font-size: var(--text-label); line-height: 1.4; word-break: break-word; }
    .empty { box-sizing: border-box; display: grid; grid-column: 1 / -1; grid-row: 1 / -1; height: 100%; place-items: center; padding: var(--space-5); color: var(--color-muted); font-size: var(--text-label); text-align: center; }
    @media (max-width: 700px) { body { place-items: start center; overflow: auto; } main { width: min(calc(100vw - (var(--page-pad) * 2)), calc((100dvh - (var(--page-pad) * 2)) * var(--mobile-stage-aspect))); aspect-ratio: var(--mobile-stage-aspect); } .layout { grid-template-columns: 1fr; grid-template-rows: minmax(0, var(--live-row-fr)) minmax(0, var(--vision-row-fr)); } .vision-wall { width: 100%; height: 100%; aspect-ratio: var(--vision-row-aspect); } .vision-wall::before { inset: 0 0 auto 0; border-left: 0; border-top: var(--line-thin); } .vision-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: 1fr; } .vision-cell + .vision-cell::before { top: 0; bottom: 0; left: 0; right: auto; border-top: 0; border-left: var(--line-thin); } }
  </style>
</head>
<body>
  <main>
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
  </main>
  <script>
    const liveFrame = document.getElementById('live-frame');
    const visionGrid = document.getElementById('vision-grid');
    const visionStatus = document.getElementById('vision-status');

    function text(node, value) { node.appendChild(document.createTextNode(value)); }

    function setAspectVars(liveAspect, visionAspect) {
      const live = Number.isFinite(liveAspect) && liveAspect > 0 ? liveAspect : 10 / 9;
      const vision = Number.isFinite(visionAspect) && visionAspect > 0 ? visionAspect : 10 / 9;
      const root = document.documentElement.style;
      root.setProperty('--live-screen-aspect', live.toFixed(6));
      root.setProperty('--vision-screen-aspect', vision.toFixed(6));
      root.setProperty('--viewer-stage-aspect', (live + (vision / 3)).toFixed(6));
      root.setProperty('--mobile-stage-aspect', (live / (1 + (live / (vision * 3)))).toFixed(6));
      root.setProperty('--live-column-fr', live.toFixed(6) + 'fr');
      root.setProperty('--vision-column-fr', (vision / 3).toFixed(6) + 'fr');
      root.setProperty('--live-row-fr', (1 / live).toFixed(6) + 'fr');
      root.setProperty('--vision-row-fr', (1 / (vision * 3)).toFixed(6) + 'fr');
      root.setProperty('--vision-stack-aspect', (vision / 3).toFixed(6));
      root.setProperty('--vision-row-aspect', (vision * 3).toFixed(6));
    }

    function imageAspect(image, fallback) {
      return image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : fallback;
    }

    function refreshAspectVars() {
      const visionImage = visionGrid.querySelector('.vision-cell img');
      setAspectVars(imageAspect(liveFrame, 10 / 9), visionImage ? imageAspect(visionImage, 10 / 9) : 10 / 9);
    }

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
        img.addEventListener('load', refreshAspectVars, { once: true });
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

    async function tick() {
      await Promise.allSettled([refreshLiveFrame(), refreshVisionImages()]);
    }

    liveFrame.addEventListener('load', refreshAspectVars);
    setInterval(tick, 1000);
    tick();
  </script>
</body>
</html>`;
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
