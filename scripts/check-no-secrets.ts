import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SecretScanOptions {
  readonly rootDir?: string;
}

export interface SecretFinding {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly match: string;
}

export interface SecretScanResult {
  readonly rootDir: string;
  readonly scannedFiles: number;
  readonly findings: SecretFinding[];
}

const SECRET_PATTERN = /sk-[A-Za-z0-9_-]+/g;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".omo",
  "coverage",
  "dist",
  "node_modules",
  "runs"
]);
const SKIP_FILENAMES = new Set([
  "pnpm-lock.yaml"
]);
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".conf",
  ".css",
  ".env",
  ".example",
  ".gitignore",
  ".html",
  ".js",
  ".json",
  ".jsonl",
  ".md",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);
const ALLOWED_PLACEHOLDERS = new Set(["sk-REPLACE_ME"]);

export async function scanForSecrets(options: SecretScanOptions = {}): Promise<SecretScanResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const findings: SecretFinding[] = [];
  let scannedFiles = 0;

  for await (const file of walkTextFiles(rootDir, rootDir)) {
    scannedFiles += 1;
    const content = await readFile(file, "utf8");
    findings.push(...findSecrets(rootDir, file, content));
  }

  return { rootDir, scannedFiles, findings };
}

export function findSecrets(rootDir: string, file: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lineStarts = collectLineStarts(content);

  for (const match of content.matchAll(SECRET_PATTERN)) {
    const value = match[0];
    if (ALLOWED_PLACEHOLDERS.has(value)) {
      continue;
    }

    const index = match.index ?? 0;
    const location = offsetToLocation(lineStarts, index);
    findings.push({
      file: path.relative(rootDir, file),
      line: location.line,
      column: location.column,
      match: value
    });
  }

  return findings;
}

export function formatFindings(result: SecretScanResult): string {
  if (result.findings.length === 0) {
    return `Secret scan passed: scanned ${result.scannedFiles} text files under ${result.rootDir}.`;
  }

  const lines = [
    `Secret scan failed: found ${result.findings.length} secret-like value(s).`,
    "Rotate exposed keys and keep real values only in ignored .env files."
  ];

  for (const finding of result.findings) {
    lines.push(`${finding.file}:${finding.line}:${finding.column} ${finding.match}`);
  }

  return lines.join("\n");
}

async function* walkTextFiles(rootDir: string, currentDir: string): AsyncGenerator<string> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".env") && entry.name !== ".env.example") {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        yield* walkTextFiles(rootDir, absolutePath);
      }
      continue;
    }

    if (!entry.isFile() || !isScannableTextFile(entry.name)) {
      continue;
    }

    const fileStat = await stat(absolutePath);
    if (fileStat.size <= MAX_TEXT_FILE_BYTES) {
      yield absolutePath;
    }
  }
}

function isScannableTextFile(fileName: string): boolean {
  if (SKIP_FILENAMES.has(fileName)) {
    return false;
  }

  return TEXT_EXTENSIONS.has(path.extname(fileName)) || TEXT_EXTENSIONS.has(fileName);
}

function collectLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetToLocation(lineStarts: readonly number[], offset: number): { line: number; column: number } {
  let lineIndex = 0;
  for (let index = 0; index < lineStarts.length; index += 1) {
    if (lineStarts[index] > offset) {
      break;
    }
    lineIndex = index;
  }

  return {
    line: lineIndex + 1,
    column: offset - lineStarts[lineIndex] + 1
  };
}

async function main(): Promise<void> {
  const result = await scanForSecrets();
  const output = formatFindings(result);

  if (result.findings.length > 0) {
    console.error(output);
    process.exitCode = 1;
    return;
  }

  console.log(output);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === currentFile) {
  await main();
}
