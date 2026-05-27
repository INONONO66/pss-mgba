import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { FullGameState } from "../game/PokemonTypes.js";
import type { SupervisorAssessment, SupervisorGoal } from "./SupervisorTypes.js";

const execFileAsync = promisify(execFile);

const DEFAULT_ESCALATION_THRESHOLD = 30;
const DEFAULT_TURN_CONTEXT_COUNT = 5;
const ISSUE_LABEL = "stuck-escalation";
const TURN_FILE_PATTERN = /^\d{6}\.json$/;
const ISSUE_NUMBER_PATTERN = /\/issues\/(\d+)/;

export interface StuckEscalatorConfig {
  readonly evidenceDir: string;
  readonly runId: string;
  readonly escalationThreshold?: number;
  readonly turnContextCount?: number;
  readonly execGh?: typeof execFileAsync;
}

export interface StuckSnapshot {
  readonly step: number;
  readonly assessment: SupervisorAssessment;
  readonly activeGoal: SupervisorGoal;
  readonly fullState?: FullGameState;
  readonly screenshotPath?: string;
  readonly adviserHintGiven: boolean;
  readonly interventionAttempted: boolean;
}

interface EscalationResult {
  readonly issueNumber: number;
  readonly issueUrl: string;
  readonly situationKey: string;
}

export class StuckEscalator {
  private readonly config: Required<Pick<StuckEscalatorConfig, "escalationThreshold" | "turnContextCount">>
    & StuckEscalatorConfig;
  private consecutiveStuckTurns = 0;
  private readonly escalatedKeys = new Set<string>();
  private lastEscalationStep = 0;

  constructor(config: StuckEscalatorConfig) {
    this.config = {
      ...config,
      escalationThreshold: config.escalationThreshold ?? DEFAULT_ESCALATION_THRESHOLD,
      turnContextCount: config.turnContextCount ?? DEFAULT_TURN_CONTEXT_COUNT,
    };
  }

  reportStuck(_snapshot: StuckSnapshot): void {
    this.consecutiveStuckTurns += 1;
  }

  reportProgress(): void {
    this.consecutiveStuckTurns = 0;
  }

  shouldEscalate(snapshot: StuckSnapshot): boolean {
    if (this.consecutiveStuckTurns < this.config.escalationThreshold) {
      return false;
    }
    if (snapshot.step - this.lastEscalationStep < this.config.escalationThreshold) {
      return false;
    }
    const key = buildSituationKey(snapshot);
    return !this.escalatedKeys.has(key);
  }

  async maybeEscalate(snapshot: StuckSnapshot): Promise<EscalationResult | undefined> {
    if (!this.shouldEscalate(snapshot)) {
      return;
    }

    const key = buildSituationKey(snapshot);
    const turnLogs = await this.readRecentTurns();
    const body = buildIssueBody(snapshot, turnLogs, this.config.runId, this.consecutiveStuckTurns);
    const title = buildIssueTitle(snapshot);

    try {
      const result = await this.createGithubIssue(title, body, key);
      this.escalatedKeys.add(key);
      this.lastEscalationStep = snapshot.step;
      return result;
    } catch (error) {
      console.warn("StuckEscalator: failed to create GitHub issue", error);
      return;
    }
  }

  getConsecutiveStuckTurns(): number {
    return this.consecutiveStuckTurns;
  }

  getEscalatedKeys(): ReadonlySet<string> {
    return this.escalatedKeys;
  }

  private async createGithubIssue(title: string, body: string, situationKey: string): Promise<EscalationResult> {
    const exec = this.config.execGh ?? execFileAsync;
    const { stdout } = await exec("gh", [
      "issue", "create",
      "--title", title,
      "--body", body,
      "--label", ISSUE_LABEL,
    ], { timeout: 30_000 });

    const issueUrl = stdout.trim();
    const numberMatch = issueUrl.match(ISSUE_NUMBER_PATTERN);
    const issueNumber = numberMatch ? Number(numberMatch[1]) : 0;

    return { issueNumber, issueUrl, situationKey };
  }

  private async readRecentTurns(): Promise<readonly TurnSummary[]> {
    const turnsDir = path.join(this.config.evidenceDir, this.config.runId, "turns");
    let entries: string[];
    try {
      entries = await readdir(turnsDir);
    } catch {
      return [];
    }

    const jsonFiles = entries
      .filter((f) => TURN_FILE_PATTERN.test(f))
      .sort()
      .slice(-this.config.turnContextCount);

    const results: TurnSummary[] = [];
    for (const file of jsonFiles) {
      try {
        const raw = JSON.parse(await readFile(path.join(turnsDir, file), "utf8")) as Record<string, unknown>;
        results.push(summarizeTurn(raw));
      } catch { /* skip unreadable */ }
    }
    return results;
  }
}

interface TurnSummary {
  readonly turn: number;
  readonly toolCalls: string[];
  readonly gameStateBrief: string;
  readonly reasoning: string;
}

function summarizeTurn(raw: Record<string, unknown>): TurnSummary {
  const turn = typeof raw.turn === "number" ? raw.turn : 0;
  const toolCalls = extractToolCalls(raw);
  const gameStateBrief = extractGameStateBrief(raw);
  const reasoning = typeof raw.reasoning === "string" ? raw.reasoning.slice(0, 300) : "";
  return { turn, toolCalls, gameStateBrief, reasoning };
}

function extractToolCalls(raw: Record<string, unknown>): string[] {
  const toolCalls: string[] = [];
  if (!Array.isArray(raw.toolCalls)) {
    return toolCalls;
  }
  for (const tc of raw.toolCalls) {
    if (tc && typeof tc === "object" && "toolName" in tc) {
      const record = tc as Record<string, unknown>;
      const name = String(record.toolName);
      const input = JSON.stringify(record.input ?? {}).slice(0, 200);
      toolCalls.push(`${name}(${input})`);
    }
  }
  return toolCalls;
}

function extractGameStateBrief(raw: Record<string, unknown>): string {
  const gs = raw.gameState as Record<string, unknown> | undefined;
  if (!gs || typeof gs !== "object") {
    return "unknown";
  }
  const after = (gs.after ?? gs.before) as Record<string, unknown> | undefined;
  if (!after || typeof after !== "object") {
    return "unknown";
  }
  const player = after.player as Record<string, unknown> | undefined;
  const pos = player?.position as Record<string, unknown> | undefined;
  if (!pos) {
    return "unknown";
  }
  const mapObj = after.map as Record<string, unknown> | undefined;
  const mapName = mapObj?.mapName ?? pos.mapId;
  return `map=${mapName} pos=(${pos.x},${pos.y})`;
}

function buildSituationKey(snapshot: StuckSnapshot): string {
  const mapId = snapshot.fullState?.player.position.mapId ?? "unknown";
  const badges = snapshot.fullState?.player.badges.count ?? 0;
  const goalKind = snapshot.activeGoal.kind;
  const firstReason = snapshot.assessment.reasons[0]?.slice(0, 40) ?? "unknown";
  return `map:${mapId}:badges:${badges}:goal:${goalKind}:reason:${firstReason}`;
}

function buildIssueTitle(snapshot: StuckSnapshot): string {
  const mapName = snapshot.fullState?.map.mapName ?? `map ${snapshot.fullState?.player.position.mapId ?? "?"}`;
  const badges = snapshot.fullState?.player.badges.count ?? "?";
  const goal = snapshot.activeGoal.title;
  return `[Stuck] ${mapName} (${badges} badges) - ${goal}`;
}

function buildIssueBody(
  snapshot: StuckSnapshot,
  turnLogs: readonly TurnSummary[],
  runId: string,
  consecutiveStuckTurns: number,
): string {
  const lines: string[] = [];

  lines.push("## Stuck Escalation Report\n");
  lines.push(`- **Run ID**: \`${runId}\``);
  lines.push(`- **Step**: ${snapshot.step}`);
  lines.push(`- **Consecutive stuck turns**: ${consecutiveStuckTurns}`);
  lines.push(`- **Adviser hint given**: ${snapshot.adviserHintGiven}`);
  lines.push(`- **Intervention attempted**: ${snapshot.interventionAttempted}`);
  lines.push("");

  appendGameStateSection(lines, snapshot.fullState);
  appendAssessmentSection(lines, snapshot.assessment);
  appendGoalSection(lines, snapshot.activeGoal);
  appendTurnLogsSection(lines, turnLogs);
  appendSuggestedInvestigation(lines);

  return lines.join("\n");
}

function appendGameStateSection(lines: string[], state: FullGameState | undefined): void {
  lines.push("## Game State\n");
  if (!state) {
    lines.push("Game state unavailable.");
    lines.push("");
    return;
  }
  lines.push(`- **Map**: ${state.map.mapName} (id ${state.player.position.mapId})`);
  lines.push(`- **Position**: (${state.player.position.x}, ${state.player.position.y})`);
  lines.push(`- **Badges**: ${state.player.badges.count}/8`);
  const party = state.party.members
    .map((p) => `${p.species} Lv${p.level} ${p.hp}/${p.maxHp}HP`)
    .join(", ");
  lines.push(`- **Party**: ${party || "none"}`);
  lines.push(`- **In battle**: ${state.battle.inBattle}`);
  lines.push(`- **Dialog active**: ${state.dialog.active}`);
  lines.push("");
}

function appendAssessmentSection(lines: string[], assessment: SupervisorAssessment): void {
  lines.push("## Stuck Assessment\n");
  lines.push(`- **State**: ${assessment.state}`);
  lines.push(`- **Repeated actions**: ${assessment.repeatedActionCount}`);
  lines.push(`- **Stable location count**: ${assessment.stableLocationCount}`);
  lines.push("\n**Reasons**:\n");
  for (const reason of assessment.reasons) {
    lines.push(`- ${reason}`);
  }
  lines.push("");
}

function appendGoalSection(lines: string[], goal: SupervisorGoal): void {
  lines.push("## Active Goal\n");
  lines.push(`- **Kind**: ${goal.kind}`);
  lines.push(`- **Title**: ${goal.title}`);
  lines.push(`- **Why**: ${goal.why}`);
  lines.push("");
}

function appendTurnLogsSection(lines: string[], turnLogs: readonly TurnSummary[]): void {
  if (turnLogs.length === 0) {
    return;
  }
  lines.push(`## Recent Turns (last ${turnLogs.length})\n`);
  for (const turn of turnLogs) {
    lines.push(`### Turn ${turn.turn}`);
    lines.push(`- **State**: ${turn.gameStateBrief}`);
    lines.push(`- **Tools**: ${turn.toolCalls.join(", ") || "none"}`);
    if (turn.reasoning) {
      lines.push(`- **Reasoning**: ${turn.reasoning.slice(0, 200)}...`);
    }
    lines.push("");
  }
}

function appendSuggestedInvestigation(lines: string[]): void {
  lines.push("## Suggested Investigation\n");
  lines.push("1. Check if the agent's navigation logic handles this map correctly");
  lines.push("2. Review the tool calls pattern for loops or dead-end strategies");
  lines.push("3. Verify the walkthrough guidance for this game stage");
  lines.push("4. Consider if a new tool or strategy is needed for this situation");
}
