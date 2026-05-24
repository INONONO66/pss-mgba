import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startViewerServer } from "../src/viewer-server";

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
  vi.restoreAllMocks();
});

describe("startViewerServer", () => {
  it("serves health checks", async () => {
    const { baseUrl } = await startTestServer();

    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("lists runs latest first with trace availability flags", async () => {
    const runsDir = await tempDir();
    await writeRun(runsDir, "run-old", { iteration: 1, runId: "run-old" });
    await writeRun(runsDir, "run-new", { iteration: 2, runId: "run-new" });
    await writeFile(join(runsDir, "run-new", "events.jsonl"), "{}\n");
    await writeFile(join(runsDir, "run-old", "token-usage.jsonl"), "{}\n");
    const { baseUrl } = await startTestServer({ runsDir });

    const response = await fetch(`${baseUrl}/api/runs`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { hasEvents: true, hasTokenUsage: false, iteration: 2, runId: "run-new" },
      { hasEvents: false, hasTokenUsage: true, iteration: 1, runId: "run-old" },
    ]);
  });

  it("returns the latest run or a JSON 404 when none exist", async () => {
    const runsDir = await tempDir();
    await writeRun(runsDir, "run-a", { iteration: 7, runId: "run-a" });
    const populated = await startTestServer({ runsDir });
    const empty = await startTestServer({ runsDir: await tempDir() });

    const latestResponse = await fetch(`${populated.baseUrl}/api/runs/latest`);
    const emptyResponse = await fetch(`${empty.baseUrl}/api/runs/latest`);

    expect(latestResponse.status).toBe(200);
    expect(await latestResponse.json()).toEqual({
      hasEvents: false,
      hasTokenUsage: false,
      iteration: 7,
      runId: "run-a",
    });
    expect(emptyResponse.status).toBe(404);
    expect(await emptyResponse.json()).toEqual({
      error: "no trace runs found",
    });
  });

  it("returns parsed events and token usage JSONL arrays", async () => {
    const runsDir = await tempDir();
    await writeRun(runsDir, "run-a", { iteration: 1, runId: "run-a" });
    await writeFile(
      join(runsDir, "run-a", "events.jsonl"),
      '\n {"type":"observation","turn":1} \n\n{"type":"agent-event","turn":1}\n'
    );
    await writeFile(
      join(runsDir, "run-a", "token-usage.jsonl"),
      '{"type":"llm-step","step":1}\n{"type":"turn-summary","steps":1}\n'
    );
    const { baseUrl } = await startTestServer({ runsDir });

    const eventsResponse = await fetch(`${baseUrl}/api/runs/run-a/events`);
    const tokensResponse = await fetch(`${baseUrl}/api/runs/run-a/tokens`);

    expect(eventsResponse.status).toBe(200);
    expect(await eventsResponse.json()).toEqual([
      { type: "observation", turn: 1 },
      { type: "agent-event", turn: 1 },
    ]);
    expect(tokensResponse.status).toBe(200);
    expect(await tokensResponse.json()).toEqual([
      { step: 1, type: "llm-step" },
      { steps: 1, type: "turn-summary" },
    ]);
  });

  it("returns empty arrays for missing JSONL files", async () => {
    const runsDir = await tempDir();
    await writeRun(runsDir, "run-a", { iteration: 1, runId: "run-a" });
    const { baseUrl } = await startTestServer({ runsDir });

    const eventsResponse = await fetch(`${baseUrl}/api/runs/run-a/events`);
    const tokensResponse = await fetch(`${baseUrl}/api/runs/run-a/tokens`);

    expect(await eventsResponse.json()).toEqual([]);
    expect(await tokensResponse.json()).toEqual([]);
  });

  it("rejects invalid run ids and path traversal", async () => {
    const { baseUrl } = await startTestServer({ runsDir: await tempDir() });

    const traversalResponse = await fetch(
      `${baseUrl}/api/runs/..%2Fsecret/events`
    );
    const invalidResponse = await fetch(`${baseUrl}/api/runs/%20bad/events`);

    expect(traversalResponse.status).toBe(404);
    expect(await traversalResponse.json()).toEqual({ error: "not found" });
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({ error: "invalid run id" });
  });

  it("returns JSON errors for malformed JSONL and unknown paths", async () => {
    const runsDir = await tempDir();
    await writeRun(runsDir, "run-a", { iteration: 1, runId: "run-a" });
    await writeFile(join(runsDir, "run-a", "events.jsonl"), "{not-json}\n");
    const { baseUrl } = await startTestServer({ runsDir });

    const malformedResponse = await fetch(`${baseUrl}/api/runs/run-a/events`);
    const unknownResponse = await fetch(`${baseUrl}/missing`);

    expect(malformedResponse.status).toBe(400);
    expect(await malformedResponse.json()).toEqual({
      error: "malformed JSONL in events.jsonl",
    });
    expect(unknownResponse.status).toBe(404);
    expect(await unknownResponse.json()).toEqual({ error: "not found" });
  });

  it("serves static files when available and a fallback page when missing", async () => {
    const staticDir = await tempDir();
    await mkdir(join(staticDir, "assets"), { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<h1>viewer</h1>");
    await writeFile(
      join(staticDir, "assets", "app.js"),
      "console.log('viewer');"
    );
    const withStatic = await startTestServer({ staticDir });
    const withoutStatic = await startTestServer();

    const indexResponse = await fetch(`${withStatic.baseUrl}/`);
    const assetResponse = await fetch(`${withStatic.baseUrl}/assets/app.js`);
    const fallbackResponse = await fetch(`${withoutStatic.baseUrl}/`);

    expect(indexResponse.status).toBe(200);
    expect(await indexResponse.text()).toBe("<h1>viewer</h1>");
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.text()).toBe("console.log('viewer');");
    expect(fallbackResponse.status).toBe(200);
    expect(await fallbackResponse.text()).toContain(
      "Trace viewer API is running"
    );
  });

  it("does not follow symlinked run directories outside the runs root", async () => {
    const runsDir = await tempDir();
    const outsideDir = await tempDir();
    await writeRun(outsideDir, "escaped-run", {
      iteration: 99,
      runId: "escaped-run",
    });
    const linked = await createSymlink(
      join(outsideDir, "escaped-run"),
      join(runsDir, "escaped-run"),
      "dir"
    );
    if (!linked) {
      return;
    }
    const { baseUrl } = await startTestServer({ runsDir });

    const runsResponse = await fetch(`${baseUrl}/api/runs`);
    const eventsResponse = await fetch(
      `${baseUrl}/api/runs/escaped-run/events`
    );

    expect(runsResponse.status).toBe(200);
    expect(await runsResponse.json()).toEqual([]);
    expect(eventsResponse.status).toBe(400);
    expect(await eventsResponse.json()).toEqual({ error: "invalid run id" });
  });

  it("does not serve symlinked static assets outside the static root", async () => {
    const staticDir = await tempDir();
    const outsideDir = await tempDir();
    await mkdir(join(staticDir, "assets"), { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<h1>viewer</h1>");
    await writeFile(join(outsideDir, "secret.js"), "console.log('secret');");
    const linked = await createSymlink(
      join(outsideDir, "secret.js"),
      join(staticDir, "assets", "secret.js"),
      "file"
    );
    if (!linked) {
      return;
    }
    const { baseUrl } = await startTestServer({ staticDir });

    const indexResponse = await fetch(`${baseUrl}/`);
    const assetResponse = await fetch(`${baseUrl}/assets/secret.js`);

    expect(indexResponse.status).toBe(200);
    expect(await indexResponse.text()).toBe("<h1>viewer</h1>");
    expect(assetResponse.status).toBe(400);
    expect(await assetResponse.json()).toEqual({
      error: "invalid static path",
    });
  });
});

async function startTestServer({
  runsDir,
  staticDir,
}: {
  runsDir?: string;
  staticDir?: string;
} = {}): Promise<{ baseUrl: string }> {
  const consoleDir = vi.spyOn(console, "dir").mockImplementation(() => {
    return;
  });
  const server = startViewerServer({
    host: "127.0.0.1",
    port: 0,
    runsDir: runsDir ?? (await tempDir()),
    staticDir,
  });
  openServers.push(server);
  await once(server, "listening");
  consoleDir.mockRestore();
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("expected TCP server address");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

async function writeRun(
  runsDir: string,
  runId: string,
  run: Record<string, unknown>
): Promise<void> {
  const runDir = join(runsDir, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "run.json"), JSON.stringify(run));
}

function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "viewer-server-"));
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function createSymlink(
  target: string,
  path: string,
  type: "dir" | "file"
): Promise<boolean> {
  try {
    await symlink(target, path, type);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      (hasCode(error, "EPERM") ||
        hasCode(error, "EACCES") ||
        hasCode(error, "ENOTSUP"))
    ) {
      return false;
    }
    throw error;
  }
}

function hasCode(error: Error, code: string): boolean {
  return (error as Error & { code?: unknown }).code === code;
}

function once(server: Server, event: "close" | "listening"): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once(event, () => resolve());
    server.once("error", reject);
  });
}
