import { createReadStream } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { basename, extname, join, normalize, resolve, sep } from "node:path";
import { DEFAULT_RUNS_DIR } from "./run-summary";
import type { TokenUsageMetric } from "./token-usage";
import { EVENTS_JSONL_FILENAME, type ViewerEvent } from "./viewer-events";

export interface ViewerServerOptions {
  host: string;
  port: number;
  runsDir?: string;
  staticDir?: string;
}

export interface ViewerRun {
  hasEvents: boolean;
  hasTokenUsage: boolean;
  runId: string;
  [key: string]: unknown;
}

interface JsonError {
  error: string;
}

const EVENTS_ROUTE_PATTERN = /^\/api\/runs\/([^/]+)\/events$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TOKEN_USAGE_JSONL_FILENAME = "token-usage.jsonl";
const TOKENS_ROUTE_PATTERN = /^\/api\/runs\/([^/]+)\/tokens$/;

export function startViewerServer({
  host,
  port,
  runsDir = DEFAULT_RUNS_DIR,
  staticDir,
}: ViewerServerOptions): Server {
  const server = createServer((request, response) => {
    handleRequest(request.url ?? "/", response, { runsDir, staticDir }).catch(
      (error: unknown) => {
        writeJson(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    );
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.dir({
        address: host,
        code: error.code,
        message: `viewer server unavailable: ${host}:${port} is already in use`,
        port,
        type: "viewer-server-unavailable",
      });
      server.close();
      return;
    }

    throw error;
  });

  server.listen(port, host, () => {
    console.dir({
      type: "viewer-server",
      url: `http://${host}:${port}/`,
    });
  });

  return server;
}

async function handleRequest(
  rawUrl: string,
  response: ServerResponse,
  options: Pick<ViewerServerOptions, "runsDir" | "staticDir">
): Promise<void> {
  const url = new URL(rawUrl, "http://127.0.0.1");
  const path = decodeURIComponent(url.pathname);

  if (path === "/healthz") {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (path === "/api/runs") {
    writeJson(
      response,
      200,
      await readRuns(options.runsDir ?? DEFAULT_RUNS_DIR)
    );
    return;
  }

  if (path === "/api/runs/latest") {
    const runs = await readRuns(options.runsDir ?? DEFAULT_RUNS_DIR);
    if (runs.length === 0) {
      writeJson(response, 404, { error: "no trace runs found" });
      return;
    }
    writeJson(response, 200, runs[0]);
    return;
  }

  const eventsMatch = path.match(EVENTS_ROUTE_PATTERN);
  if (eventsMatch) {
    await writeRunJsonl<ViewerEvent>(
      response,
      options.runsDir ?? DEFAULT_RUNS_DIR,
      eventsMatch[1],
      EVENTS_JSONL_FILENAME
    );
    return;
  }

  const tokensMatch = path.match(TOKENS_ROUTE_PATTERN);
  if (tokensMatch) {
    await writeRunJsonl<TokenUsageMetric>(
      response,
      options.runsDir ?? DEFAULT_RUNS_DIR,
      tokensMatch[1],
      TOKEN_USAGE_JSONL_FILENAME
    );
    return;
  }

  if (await tryServeStatic(response, path, options.staticDir)) {
    return;
  }

  if (path === "/" || path === "/index.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><title>Trace Viewer</title><h1>Trace viewer API is running</h1><p>Build web/dist to serve the React viewer.</p>"
    );
    return;
  }

  writeJson(response, 404, { error: "not found" });
}

async function readRuns(runsDir: string): Promise<ViewerRun[]> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch (error) {
    if (error instanceof Error && hasCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const runs = await Promise.all(
    entries.map((entry) => {
      if (!isValidRunId(entry)) {
        return null;
      }
      return readRun(runsDir, entry);
    })
  );

  return runs
    .filter((run): run is ViewerRun => Boolean(run))
    .sort((left, right) => compareRunsLatestFirst(left, right));
}

async function readRun(
  runsDir: string,
  runId: string
): Promise<ViewerRun | null> {
  const runDir = runDirectory(runsDir, runId);
  const runJsonPath = join(runDir, "run.json");
  try {
    const directoryStat = await lstat(runDir);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      return null;
    }
    const run = JSON.parse(await readFile(runJsonPath, "utf8")) as Record<
      string,
      unknown
    >;
    return {
      ...run,
      hasEvents: await fileExists(join(runDir, EVENTS_JSONL_FILENAME)),
      hasTokenUsage: await fileExists(join(runDir, TOKEN_USAGE_JSONL_FILENAME)),
      runId,
    };
  } catch (error) {
    if (error instanceof Error && hasCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function writeRunJsonl<T>(
  response: ServerResponse,
  runsDir: string,
  runId: string | undefined,
  filename: string
): Promise<void> {
  if (!(runId && isValidRunId(runId))) {
    writeJson(response, 400, { error: "invalid run id" });
    return;
  }

  const runDir = runDirectory(runsDir, runId);
  if (!(await isDirectChildDirectory(runsDir, runDir))) {
    writeJson(response, 400, { error: "invalid run id" });
    return;
  }

  const filePath = join(runDir, filename);
  try {
    writeJson(response, 200, parseJsonl<T>(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error instanceof Error && hasCode(error, "ENOENT")) {
      writeJson(response, 200, []);
      return;
    }
    if (error instanceof SyntaxError) {
      writeJson(response, 400, { error: `malformed JSONL in ${filename}` });
      return;
    }
    throw error;
  }
}

function parseJsonl<T>(content: string): T[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function tryServeStatic(
  response: ServerResponse,
  path: string,
  staticDir: string | undefined
): Promise<boolean> {
  if (!staticDir) {
    return false;
  }

  const relativePath = path === "/" ? "index.html" : path.slice(1);
  if (!relativePath || relativePath.includes("\0")) {
    return false;
  }
  const root = resolve(staticDir);
  const filePath = resolve(root, normalize(relativePath));
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    writeJson(response, 400, { error: "invalid static path" });
    return true;
  }

  try {
    const fileStat = await lstat(filePath);
    if (fileStat.isSymbolicLink()) {
      writeJson(response, 400, { error: "invalid static path" });
      return true;
    }
    if (!fileStat.isFile()) {
      return false;
    }
  } catch (error) {
    if (error instanceof Error && hasCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }

  response.writeHead(200, { "content-type": contentType(filePath) });
  await new Promise<void>((resolvePromise, reject) => {
    createReadStream(filePath)
      .once("error", reject)
      .once("end", resolvePromise)
      .pipe(response);
  });
  return true;
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: JsonError | unknown[] | Record<string, unknown>
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function isDirectChildDirectory(
  runsDir: string,
  runDir: string
): Promise<boolean> {
  const runsRoot = resolve(runsDir);
  const resolvedRunDir = resolve(runDir);
  if (
    basename(resolvedRunDir) === "" ||
    resolve(runsRoot, basename(resolvedRunDir)) !== resolvedRunDir
  ) {
    return false;
  }
  try {
    const runStat = await lstat(resolvedRunDir);
    return !runStat.isSymbolicLink() && runStat.isDirectory();
  } catch (error) {
    if (error instanceof Error && hasCode(error, "ENOENT")) {
      return true;
    }
    throw error;
  }
}

function runDirectory(runsDir: string, runId: string): string {
  return join(runsDir, runId);
}

function isValidRunId(runId: string): boolean {
  return RUN_ID_PATTERN.test(runId) && !runId.includes("..");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const fileStat = await lstat(path);
    return !fileStat.isSymbolicLink() && fileStat.isFile();
  } catch (error) {
    if (error instanceof Error && hasCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

function compareRunsLatestFirst(left: ViewerRun, right: ViewerRun): number {
  const leftIteration = numberField(left.iteration);
  const rightIteration = numberField(right.iteration);
  if (leftIteration !== rightIteration) {
    return rightIteration - leftIteration;
  }
  return right.runId.localeCompare(left.runId);
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function hasCode(error: Error, code: string): boolean {
  return (error as Error & { code?: unknown }).code === code;
}
