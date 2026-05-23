import "dotenv/config";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { formatDebugEvent } from "../src/evidence/EventFormatter.js";

type WatchMode = "decisions" | "vision" | "summary";

interface WatchOptions {
  readonly mode: WatchMode;
  readonly evidenceDir: string;
  readonly runId: string;
  readonly intervalMs: number;
  readonly once: boolean;
}

interface EvidenceEvent {
  readonly type: string;
  readonly sequence?: number;
  readonly timestamp: string;
  readonly payload: unknown;
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.once) {
    await render(options);
    return;
  }

  for (;;) {
    process.stdout.write("\u001b[2J\u001b[H");
    await render(options);
    await sleep(options.intervalMs);
  }
}

function parseArgs(args: readonly string[]): WatchOptions {
  const mode = parseMode(args[0]);
  let runId = process.env.HARNESS_RUN_ID ?? "";
  let evidenceDir = process.env.EVIDENCE_DIR ?? "runs";
  let intervalMs = 1000;
  let once = false;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--run-id") {
      runId = args[++index] ?? runId;
    } else if (arg === "--evidence-dir") {
      evidenceDir = args[++index] ?? evidenceDir;
    } else if (arg === "--interval-ms") {
      intervalMs = Number(args[++index] ?? intervalMs);
    } else if (arg === "--once") {
      once = true;
    }
  }

  if (runId.trim() === "") {
    throw new Error("watch-run requires --run-id or HARNESS_RUN_ID");
  }

  return {
    mode,
    evidenceDir,
    runId,
    intervalMs: Number.isInteger(intervalMs) && intervalMs > 0 ? intervalMs : 1000,
    once
  };
}

function parseMode(value: string | undefined): WatchMode {
  if (value === "decisions" || value === "vision" || value === "summary") {
    return value;
  }
  return "decisions";
}

async function render(options: WatchOptions): Promise<void> {
  const runDir = path.join(options.evidenceDir, options.runId);
  console.log(`${options.mode} | run ${options.runId}`);
  console.log(runDir);
  console.log("");

  if (options.mode === "vision") {
    await renderVision(path.join(runDir, "vision"));
    return;
  }

  if (options.mode === "summary") {
    await renderSummary(path.join(runDir, "summary.json"));
    return;
  }

  await renderDecisions(path.join(runDir, "events.jsonl"));
}

async function renderDecisions(eventsFile: string): Promise<void> {
  const events = await readEvents(eventsFile);
  if (events.length === 0) {
    console.log("Waiting for decisions...");
    return;
  }

  const interesting = events
    .filter((event) => ["decision", "action", "error", "run_finished"].includes(event.type))
    .slice(-12);

  for (const event of interesting) {
    console.log(formatDebugEvent(event) ?? `${event.timestamp} ${event.type}`);
  }
}

async function renderVision(visionDir: string): Promise<void> {
  try {
    const entries = await readdir(visionDir, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name))
      .map(async (entry) => {
        const file = path.join(visionDir, entry.name);
        const fileStat = await stat(file);
        return { name: entry.name, size: fileStat.size, mtime: fileStat.mtime };
      }));

    const latest = files.sort((left, right) => left.mtime.getTime() - right.mtime.getTime()).slice(-10);
    if (latest.length === 0) {
      console.log("Waiting for processed LLM context images...");
      return;
    }

    for (const file of latest) {
      console.log(`${file.mtime.toISOString()} ${file.name} ${file.size} bytes`);
    }
  } catch (error) {
    if (isNotFound(error)) {
      console.log("Waiting for vision directory...");
      return;
    }
    throw error;
  }
}

async function renderSummary(summaryFile: string): Promise<void> {
  try {
    console.log(await readFile(summaryFile, "utf8"));
  } catch (error) {
    if (isNotFound(error)) {
      console.log("Waiting for summary...");
      return;
    }
    throw error;
  }
}

async function readEvents(eventsFile: string): Promise<EvidenceEvent[]> {
  try {
    const content = await readFile(eventsFile, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EvidenceEvent);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
