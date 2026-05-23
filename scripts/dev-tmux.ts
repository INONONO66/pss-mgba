import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface LauncherOptions {
  readonly sessionName: string;
  readonly runId: string;
  readonly evidenceDir: string;
  readonly attach: boolean;
  readonly printOnly: boolean;
  readonly startMgbaHttp: boolean;
  readonly startMgba: boolean;
  readonly fresh: boolean;
  readonly harnessArgs: readonly string[];
}

interface PaneSpec {
  readonly title: string;
  readonly command: string;
}

const rootDir = process.cwd();

function main(args = process.argv.slice(2)): void {
  const options = parseArgs(args);
  const panes = buildPanes(options);

  if (options.printOnly) {
    printPlan(options, panes);
    return;
  }

  requireCommand("tmux");
  if (options.fresh) {
    stopExistingProcesses(options.sessionName);
  }
  if (tmuxSessionExists(options.sessionName)) {
    throw new Error(`tmux session already exists: ${options.sessionName}. Attach with: tmux attach -t ${options.sessionName}, or restart with --fresh.`);
  }

  runTmux(["new-session", "-d", "-x", "240", "-y", "80", "-s", options.sessionName, "-n", "run"]);
  for (let index = 1; index < panes.length; index += 1) {
    runTmux(["split-window", "-t", `${options.sessionName}:0`]);
  }

  runTmux(["select-layout", "-t", `${options.sessionName}:0`, "tiled"]);
  runTmux(["set-option", "-t", options.sessionName, "pane-border-status", "top"]);
  runTmux(["set-option", "-t", options.sessionName, "pane-border-format", "#{pane_index}: #{pane_title}"]);
  panes.forEach((pane, index) => runTmux(["select-pane", "-t", `${options.sessionName}:0.${index}`, "-T", pane.title]));
  panes.forEach((pane, index) => runTmux(["send-keys", "-t", `${options.sessionName}:0.${index}`, pane.command, "Enter"]));

  console.log(`tmux session started: ${options.sessionName}`);
  console.log(`run id: ${options.runId}`);
  console.log(`dev viewer: http://127.0.0.1:${process.env.DEV_VIEWER_PORT ?? "8787"}`);
  if (options.attach) {
    runTmux(["attach-session", "-t", options.sessionName]);
  }
}

function parseArgs(args: readonly string[]): LauncherOptions {
  let sessionName = process.env.TMUX_SESSION ?? "pss-mgba";
  let runId = createRunId();
  let evidenceDir = process.env.EVIDENCE_DIR ?? "runs";
  let attach = process.env.TMUX_ATTACH !== "0";
  let printOnly = false;
  let startMgbaHttp = process.env.START_MGBA_HTTP !== "0";
  let startMgba = process.env.START_MGBA !== "0";
  let fresh = false;
  const harnessArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--session":
        sessionName = args[++index] ?? sessionName;
        break;
      case "--run-id":
        throw new Error("dev:tmux uses one generated run id per session; do not pass --run-id");
      case arg?.startsWith("--run-id=") ? arg : "":
        throw new Error("dev:tmux uses one generated run id per session; do not pass --run-id");
      case "--evidence-dir":
        evidenceDir = args[++index] ?? evidenceDir;
        break;
      case "--no-attach":
        attach = false;
        break;
      case "--print":
        printOnly = true;
        attach = false;
        break;
      case "--no-mgba-http":
        startMgbaHttp = false;
        break;
      case "--no-mgba":
        startMgba = false;
        break;
      case "--fresh":
        fresh = true;
        break;
      default:
        if (arg !== undefined) {
          harnessArgs.push(arg);
        }
    }
  }

  return { sessionName, runId, evidenceDir, attach, printOnly, startMgbaHttp, startMgba, fresh, harnessArgs };
}

function buildPanes(options: LauncherOptions): PaneSpec[] {
  const runner = packageRunner();
  const tsx = path.join(rootDir, "node_modules", ".bin", "tsx");
  const watch = existsSync(tsx) ? q(tsx) : `${runner} exec tsx`;
  const watcherEnv = `HARNESS_RUN_ID=${q(options.runId)} EVIDENCE_DIR=${q(options.evidenceDir)}`;
  const harnessRunEnv = `PSS_DEV_RUN_ID=${q(options.runId)} EVIDENCE_DIR=${q(options.evidenceDir)} HARNESS_INLINE_DEBUG_LOGS=0`;
  const harnessArgs = options.harnessArgs.map(q).join(" ");
  const baseUrl = process.env.MGBA_HTTP_BASE_URL ?? "http://127.0.0.1:5001";
  const harnessCommand = `cd ${q(rootDir)} && ${harnessRunEnv} ${runner} run dev ${harnessArgs}`;

  return [
    { title: "mgba-http", command: mgbaHttpCommand(options.startMgbaHttp) },
    { title: "mGBA", command: mgbaCommand(options.startMgba) },
    { title: "harness + viewer", command: holdWhenNotReady(mgbaReadyCommand(baseUrl), `mGBA-http is not ready at ${baseUrl}; check mGBA, ROM, mGBASocketServer.lua, and RAM read endpoints`, harnessCommand) },
    { title: "decisions", command: `cd ${q(rootDir)} && ${watcherEnv} ${watch} scripts/watch-run.ts decisions --evidence-dir ${q(options.evidenceDir)}` },
    { title: "vision", command: `cd ${q(rootDir)} && ${watcherEnv} ${watch} scripts/watch-run.ts vision --evidence-dir ${q(options.evidenceDir)}` }
  ];
}

function mgbaHttpCommand(start: boolean): string {
  const binary = path.resolve(process.env.MGBA_HTTP_BIN ?? path.join(rootDir, ".local-tools", "mgba-http", "mGBA-http"));
  const baseUrl = process.env.MGBA_HTTP_BASE_URL ?? "http://127.0.0.1:5001";
  if (!start) {
    return shellHold(`START_MGBA_HTTP=0; expecting existing mGBA-http at ${baseUrl}`);
  }
  if (!existsSync(binary)) {
    return shellHold(`mGBA-http binary not found: ${binary}`);
  }

  const startCommand = `cd ${q(path.dirname(binary))} && ${q(binary)}`;
  return `if ${mgbaReadyCommand(baseUrl)}; then ${shellHold(`mGBA-http currentframe and RAM endpoints are ready at ${baseUrl}`)}; elif ${httpReachableCommand(baseUrl)}; then ${shellHold(`mGBA-http responded at ${baseUrl}, but emulator readiness failed; check mGBA, ROM, mGBASocketServer.lua, and RAM read endpoints`)}; else ${startCommand}; fi; ${printExitStatus()}`;
}

function mgbaCommand(start: boolean): string {
  const romPath = process.env.POKEMON_ROM_PATH;
  const scriptPath = path.resolve(process.env.MGBA_LUA_SCRIPT ?? path.join(rootDir, ".local-tools", "mgba-http", "mGBASocketServer.lua"));
  const mgbaBin = process.env.MGBA_BIN ?? "mgba";
  if (!start) {
    return shellHold("START_MGBA=0; start mGBA manually with mGBASocketServer.lua loaded");
  }
  if (romPath === undefined || romPath.trim() === "") {
    return shellHold("POKEMON_ROM_PATH is not set in .env; start mGBA manually or set it first");
  }
  if (!existsSync(scriptPath)) {
    return shellHold(`mGBASocketServer.lua not found: ${scriptPath}`);
  }

  const startCommand = `cd ${q(rootDir)} && ${q(mgbaBin)} --script ${q(scriptPath)} ${q(romPath)}`;
  return holdConditionalProcess(mgbaRunningCommand(), "mGBA already appears to be running; using existing emulator", startCommand);
}

function httpReachableCommand(baseUrl: string): string {
  return `node -e ${q("fetch(process.argv[1]).then(() => process.exit(0)).catch(() => process.exit(1))")} ${q(baseUrl)}`;
}

function mgbaReadyCommand(baseUrl: string): string {
  const script = "const base=new URL(process.argv[1]); const endpoints=['/core/currentframe','/core/read8?address=0xD35E']; Promise.all(endpoints.map(path=>fetch(new URL(path, base), { signal: AbortSignal.timeout(1500) }))).then(responses=>process.exit(responses.every(response=>response.ok)?0:1)).catch(()=>process.exit(1))";
  return `node -e ${q(script)} ${q(baseUrl)}`;
}

function mgbaRunningCommand(): string {
  return "pgrep -x mgba >/dev/null 2>&1 || pgrep -x mGBA >/dev/null 2>&1";
}

function printPlan(options: LauncherOptions, panes: readonly PaneSpec[]): void {
  console.log(`session: ${options.sessionName}`);
  console.log(`run id: ${options.runId}`);
  console.log(`depends on mGBA-http: yes (${process.env.MGBA_HTTP_BASE_URL ?? "http://127.0.0.1:5001"})`);
  console.log(`fresh restart: ${options.fresh ? "yes" : "no"}`);
  console.log("");
  panes.forEach((pane, index) => {
    console.log(`[${index}] ${pane.title}`);
    console.log(pane.command);
    console.log("");
  });
}

function packageRunner(): string {
  if (commandExists("pnpm")) {
    return "pnpm";
  }
  throw new Error("pnpm is required to launch dev tmux. Install pnpm and run pnpm install.");
}

function commandExists(command: string): boolean {
  return spawnSync("/bin/sh", ["-lc", `command -v ${q(command)} >/dev/null 2>&1`], { stdio: "ignore" }).status === 0;
}

function requireCommand(command: string): void {
  if (!commandExists(command)) {
    throw new Error(`Required command not found: ${command}`);
  }
}

function tmuxSessionExists(sessionName: string): boolean {
  return spawnSync("tmux", ["has-session", "-t", sessionName], { stdio: "ignore" }).status === 0;
}

function stopExistingProcesses(sessionName: string): void {
  spawnSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
  spawnSync("/bin/sh", ["-lc", "pkill -x mGBA-http >/dev/null 2>&1 || true; pkill -x mgba >/dev/null 2>&1 || true; pkill -x mGBA >/dev/null 2>&1 || true"], { stdio: "ignore" });
}

function runTmux(args: readonly string[]): void {
  const result = spawnSync("tmux", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`tmux ${args.join(" ")} failed`);
  }
}

function shellHold(message: string): string {
  return `printf '%s\\n' ${q(message)}; printf '%s\\n' 'This pane is intentionally idle.'`;
}

function holdConditionalProcess(checkCommand: string, idleMessage: string, startCommand: string): string {
  return `if ${checkCommand}; then ${shellHold(idleMessage)}; else ${startCommand}; fi; ${printExitStatus()}`;
}

function holdWhenNotReady(checkCommand: string, notReadyMessage: string, startCommand: string): string {
  return `if ${checkCommand}; then ${startCommand}; else ${shellHold(notReadyMessage)}; fi; ${printExitStatus()}`;
}

function printExitStatus(): string {
  return `exit_code=$?; printf ${q("\\n[process exited with status %s]\\n")} "$exit_code"`;
}

function q(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

void (() => {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
})();
