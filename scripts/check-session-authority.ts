import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AuthorityFileRecord {
  readonly path: string;
  readonly text: string;
}

export interface AuthorityViolation {
  readonly file: string;
  readonly line: number;
  readonly match: string;
  readonly rule: string;
}

interface AuthorityRule {
  readonly allowlist: ReadonlyMap<string, string>;
  readonly name: string;
  readonly pattern: RegExp;
}

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const LOW_LEVEL_INPUT_ALLOWLIST = new Map<string, string>([
  [
    "src/session/input-gate.ts",
    "InputGate owns production input transactions.",
  ],
  [
    "src/control/Controller.ts",
    "Legacy CLI/manual controller; migrate or document as pre-session shim in the manual-input PR.",
  ],
  [
    "src/executor/MgbaAdapters.ts",
    "Legacy adapter boundary pending executor migration.",
  ],
  [
    "src/agent/CommandAgentContext.ts",
    "Legacy context adapter pending bridge migration.",
  ],
  [
    "src/agent/CommandAgentRunner.ts",
    "Legacy runner direct intervention paths pending session migration.",
  ],
  [
    "src/agent/command-tools.ts",
    "Legacy tool auto handling pending AutoHandler migration.",
  ],
  [
    "src/executor/BattleExecutor.ts",
    "Legacy executor pending session API migration.",
  ],
  [
    "src/executor/CommandExecutor.ts",
    "Legacy executor pending session API migration.",
  ],
  [
    "src/executor/DialogExecutor.ts",
    "Legacy executor pending session API migration.",
  ],
  [
    "src/executor/InteractExecutor.ts",
    "Legacy executor pending session API migration.",
  ],
  [
    "src/executor/NavigateExecutor.ts",
    "Legacy executor pending session API migration.",
  ],
  ["src/mgba/MgbaHttpClient.ts", "Low-level mGBA HTTP client implementation."],
  ["src/mgba/preflight.ts", "Pre-session emulator connectivity preflight."],
  [
    "src/cli/dev.ts",
    "Manual debug shim; active-session path must migrate later.",
  ],
  [
    "src/cli/index.ts",
    "Manual CLI shim; active-session path must migrate later.",
  ],
  ["scripts/test-agent-tools.ts", "Manual test utility fixture."],
  ["scripts/test-live-dialog.ts", "Live manual/integration utility fixture."],
]);

const READINESS_ALLOWLIST = new Map<string, string>([
  ["src/session/input-gate.ts", "InputGate owns readiness settling."],
  [
    "src/session/mini-state-reader.ts",
    "Session mini-state reader owns readiness evidence.",
  ],
  [
    "src/game/GameWorld.ts",
    "Domain world reader; mode/readiness evidence only.",
  ],
  ["src/game/memoryMap.ts", "Address catalog."],
  ["src/game/memory-profile.ts", "Address profile validation."],
  ["src/game/readers/ProgressReader.ts", "Domain progress reader."],
  ["src/game/mode-classification.ts", "Shared mode constants and classifier."],
  ["src/game/README.md", "Documentation."],
  ["src/executor/README.md", "Documentation."],
  ["src/agent/README.md", "Documentation."],
  [
    "src/executor/InputReadiness.ts",
    "Legacy readiness poller pending session migration.",
  ],
  [
    "src/agent/CommandAgentRunner.ts",
    "Legacy runner readiness wait pending session migration.",
  ],
  ["src/executor/MgbaAdapters.ts", "Legacy adapter pending session migration."],
]);

const REFRESH_ALLOWLIST = new Map<string, string>([
  [
    "src/agent/CommandAgentRunner.ts",
    "Legacy runner full-state refresh pending GameSession migration.",
  ],
  [
    "src/agent/command-tools.ts",
    "Legacy tool refresh pending GameSession migration.",
  ],
]);

const RULES: readonly AuthorityRule[] = [
  {
    name: "low-level-input",
    pattern:
      /\.(?:pressButton|holdButton|tapButton)\b|\bController\s*\.\s*execute\b|\bcontroller\s*(?:\?\.|\.)\s*execute\b/g,
    allowlist: LOW_LEVEL_INPUT_ALLOWLIST,
  },
  {
    name: "readiness-polling",
    pattern:
      /\bwaitForInputReady\b|\bwJoyIgnore\b|\bwWalkCounter\b|\bRWY_ADDRESS\b|\brWY\b/g,
    allowlist: READINESS_ALLOWLIST,
  },
  {
    name: "duplicate-refresh-state",
    pattern: /\brefreshState\b/g,
    allowlist: REFRESH_ALLOWLIST,
  },
];

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".omo",
  ".omx",
  "coverage",
  "dist",
  "docs",
  "node_modules",
  "runs",
]);

const SCANNED_EXTENSIONS = new Set([".md", ".ts", ".tsx"]);

export function findSessionAuthorityViolations(
  files: readonly AuthorityFileRecord[]
): AuthorityViolation[] {
  const violations: AuthorityViolation[] = [];

  for (const file of files) {
    const normalizedPath = normalizePath(file.path);
    if (isTestFile(normalizedPath)) {
      continue;
    }

    for (const rule of RULES) {
      if (rule.allowlist.has(normalizedPath)) {
        continue;
      }

      const lineStarts = collectLineStarts(file.text);
      for (const match of file.text.matchAll(rule.pattern)) {
        violations.push({
          file: normalizedPath,
          line: offsetToLine(lineStarts, match.index ?? 0),
          match: match[0],
          rule: rule.name,
        });
      }
    }
  }

  return violations;
}

export function formatAuthorityViolations(
  violations: readonly AuthorityViolation[]
): string {
  if (violations.length === 0) {
    return "Session authority guard passed.";
  }

  return [
    `Session authority guard failed: ${violations.length} unapproved occurrence(s).`,
    ...violations.map(
      (violation) =>
        `${violation.file}:${violation.line} [${violation.rule}] ${violation.match}`
    ),
  ].join("\n");
}

async function readRepositoryFiles(
  rootDir: string
): Promise<AuthorityFileRecord[]> {
  const files: AuthorityFileRecord[] = [];
  for await (const file of walkFiles(rootDir, rootDir)) {
    files.push({
      path: path.relative(rootDir, file),
      text: await readFile(file, "utf8"),
    });
  }
  return files;
}

async function* walkFiles(
  rootDir: string,
  currentDir: string
): AsyncGenerator<string> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        yield* walkFiles(rootDir, absolutePath);
      }
      continue;
    }

    if (!(entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name)))) {
      continue;
    }

    const fileStat = await stat(absolutePath);
    if (fileStat.size <= 1024 * 1024) {
      yield absolutePath;
    }
  }
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isTestFile(filePath: string): boolean {
  return (
    filePath.startsWith("tests/") ||
    filePath.endsWith(".test.ts") ||
    filePath.endsWith(".test.tsx")
  );
}

function collectLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetToLine(lineStarts: readonly number[], offset: number): number {
  let line = 1;
  for (let index = 0; index < lineStarts.length; index += 1) {
    if (lineStarts[index] > offset) {
      break;
    }
    line = index + 1;
  }
  return line;
}

async function main(): Promise<void> {
  const files = await readRepositoryFiles(ROOT_DIR);
  const violations = findSessionAuthorityViolations(files);
  console.log(formatAuthorityViolations(violations));
  if (violations.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
