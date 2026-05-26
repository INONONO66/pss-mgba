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
  readonly agentMemoryStore?: {
    snapshot(): {
      sections: Record<string, Array<{ id: string; createdAt: string; content: string }>>;
      updatedAt: string;
    };
  };
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

      if (isCorsPath(requestUrl.pathname)) {
        applyCorsHeaders(response);
      }

      if (request.method === "OPTIONS" && isCorsPath(requestUrl.pathname)) {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }

      if (requestUrl.pathname === "/") {
        await serveFrontend(requestUrl.pathname, response, frontendDistDir());
        return;
      }

      if (requestUrl.pathname === "/favicon.ico") {
        await serveFrontend(requestUrl.pathname, response, frontendDistDir());
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

      if (requestUrl.pathname === "/api/turns") {
        const limitParam = Number(requestUrl.searchParams.get("limit") ?? "10");
        const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(50, Math.trunc(limitParam))) : 10;
        const turns = await listLatestJsonRecords(paths.turnsDir, limit);
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ runId: options.runId, limit, count: turns.length, turns }));
        return;
      }

      if (requestUrl.pathname === "/api/game-state") {
        const limitParam = Number(requestUrl.searchParams.get("limit") ?? "5");
        const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(50, Math.trunc(limitParam))) : 5;
        const states = await listLatestTurnStates(paths.turnsDir, limit);
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

      if (requestUrl.pathname === "/api/global/run-summary") {
        const summary = await readRunSummary(paths.summaryFile, options.runId);
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify(summary));
        return;
      }

      if (requestUrl.pathname === "/api/global/agent-memory") {
        const memoryData = options.agentMemoryStore?.snapshot();
        const sections = memoryData?.sections ?? { objectives: [], journal: [], notes: [], strategy: [] };
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ runId: options.runId, updatedAt: memoryData?.updatedAt ?? null, sections }));
        return;
      }

      if (requestUrl.pathname === "/api/global/map-memory") {
        const mapMemory = await readJsonRecord(paths.mapMemoryFile);
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ runId: options.runId, ...(mapMemory ?? { version: 1, maps: {} }) }));
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

      if (requestUrl.pathname.startsWith("/api/")) {
        response.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ error: "api endpoint not found" }));
        return;
      }

      await serveFrontend(requestUrl.pathname, response, frontendDistDir());
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
}

function isCorsPath(requestPath: string): boolean {
  return requestPath.startsWith("/api/") || requestPath.startsWith("/vision/") || requestPath.startsWith("/raw-screenshots/");
}

function applyCorsHeaders(response: http.ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function frontendDistDir(): string {
  return path.resolve(process.cwd(), "viewer", "dist");
}

async function serveFrontend(requestPath: string, response: http.ServerResponse, distDir: string): Promise<void> {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const decodedPath = decodeURIComponent(normalizedPath);
  const requestedFile = path.resolve(path.join(distDir, decodedPath));
  const resolvedDist = path.resolve(distDir);

  if (!requestedFile.startsWith(`${resolvedDist}${path.sep}`) && requestedFile !== resolvedDist) {
    response.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" });
    response.end("invalid frontend path");
    return;
  }

  const filePath = await readableFile(requestedFile) ? requestedFile : path.join(distDir, "index.html");
  const bytes = await readVisionFile(filePath);
  if (bytes === undefined) {
    response.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Viewer build required</title></head><body style="background:#070b08;color:#edf8d8;font-family:ui-monospace,Menlo,monospace;padding:32px"><h1>viewer/dist 빌드가 없습니다</h1><p><code>cd viewer && pnpm install && pnpm build</code>를 실행하세요.</p><p>개발 중이면 Vite 서버를 실행하고 <a style="color:#8cff71" href="http://127.0.0.1:5173/">http://127.0.0.1:5173/</a>로 접속하세요.</p></body></html>`);
    return;
  }

  response.writeHead(200, { "content-type": contentTypeFor(filePath), "cache-control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable" });
  response.end(bytes);
}

async function readableFile(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".js") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".ico") {
    return "image/x-icon";
  }
  return "application/octet-stream";
}

async function listLatestJsonRecords(directory: string, limit: number): Promise<Array<Record<string, unknown>>> {
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

  const records: Array<Record<string, unknown>> = [];
  for (const fileName of files) {
    const filePath = path.join(directory, fileName);
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
      const sanitized = sanitizeConversationForDashboard(parsed);
      records.push({
        ...(isRecord(sanitized) ? sanitized : {}),
        fileName
      });
    } catch {
      records.push({ fileName, error: "failed to read artifact" });
    }
  }
  return records;
}

async function listLatestTurnStates(directory: string, limit: number): Promise<Array<Record<string, unknown>>> {
  return (await listLatestJsonRecords(directory, limit)).map((turn) => ({
    fileName: turn.fileName,
    step: turn.turn,
    frame: isRecord(turn.frame) ? turn.frame.after ?? turn.frame.before : undefined,
    state: isRecord(turn.gameState) ? turn.gameState.after ?? turn.gameState.before : undefined,
  }));
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
