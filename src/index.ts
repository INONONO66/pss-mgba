import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent } from "@minpeter/pss-runtime";
import { createReasoningLlm } from "./agent-llm";
import { env } from "./env";
import { startMetricsServer } from "./metrics-server";
import { MgbaHttpClient } from "./mgba-http";
import type { MgbaObservation } from "./observation";
import { PokemonMilestoneTracker } from "./pokemon-milestones";
import { createPrettyLogger } from "./pretty-log";
import { RunMetricsTracker } from "./run-metrics";
import {
  createOptimizedFreshRunTrace,
  updateRunTraceMetadata,
} from "./run-trace";
import { createObservedTurnInput, streamSupervisedRun } from "./runner";
import { StuckMemory } from "./stuck-memory";
import { createTrackedModel, TokenUsageTracker } from "./token-usage";
import { createMgbaControlPlane, describeMgbaControlPlane } from "./tools";
import { createViewerEventRecorder } from "./viewer-recorder";

const provider = createOpenAICompatible({
  apiKey: env.AI_API_KEY,
  baseURL: env.AI_BASE_URL,
  name: "pokemon",
});

const instructions = [
  "You are a concise Pokemon-playing control agent.",
  describeMgbaControlPlane(),
  "When playing autonomously, use a loop of injected observation -> decide -> one action -> brief summary.",
  "Use red movement guide lines to distinguish blocked cells, open walkable cells, and interactable-looking objects. Prefer exploring open unseen space or facing likely objects and pressing A.",
  "Movement duration calibration: 10=1 red cell, 20=2 cells, 45=3 cells, 60=4 cells, 75=5 cells, 90=6 cells. Longer movement is possible with larger duration on clearly open straight paths; near obstacles, move one cell and re-observe.",
  "Track recent action context and avoid repeating actions that did not visibly change progress.",
  "Before any tool call, output exactly one <action_plan>...</action_plan> block containing the medium-term goal, visible blocked/open/object assessment, intended target, next action, and recent repetition to avoid.",
  "Keep final user-facing answers under 3 lines, but use tools whenever game control is requested.",
].join("\n\n");
const mgbaClient = new MgbaHttpClient({ baseUrl: env.MGBA_HTTP_BASE_URL });
const tools = createMgbaControlPlane({
  client: mgbaClient,
  onSupervisorIntervention: (intervention) => {
    runMetricsTracker.recordSupervisorIntervention(intervention.reason);
    const event = {
      intervention,
      type: "supervisor-intervention",
    };
    prettyLogger.event(event as never);
    fireAndReportViewerWrite(
      viewerEventRecorder.recordEvent(event, { turn: turnsRun })
    );
  },
});
let runTrace = await createOptimizedFreshRunTrace();
const viewerEventRecorder = createViewerEventRecorder({ trace: runTrace });
const prettyLogger = createPrettyLogger();
prettyLogger.runTrace(runTrace);
const runMetricsTracker = new RunMetricsTracker({
  experimentId: runTrace.experimentId,
  iteration: runTrace.iteration,
  mode: runTrace.mode,
  runId: runTrace.runId,
});
const tokenUsageTracker = new TokenUsageTracker({
  iteration: runTrace.iteration,
  metricsDir: runTrace.metricsDir,
  runId: runTrace.runId,
  onMetric: prettyLogger.tokenUsage,
});

startMetricsServer(tokenUsageTracker, runMetricsTracker, {
  host: env.METRICS_HTTP_HOST,
  port: env.METRICS_HTTP_PORT,
});

const agent = await Agent.create({
  llm: createReasoningLlm({
    instructions,
    model: createTrackedModel({
      model: provider(env.AI_MODEL),
      tracker: tokenUsageTracker,
    }),
    reasoning: env.AI_REASONING,
    tools,
  }),
});

const session = agent.session("pokemon-run");
const recentActions: string[] = [];
const milestoneTracker = new PokemonMilestoneTracker();
const stuckMemory = new StuckMemory();
let turnsRun = 0;

while (true) {
  turnsRun += 1;
  tokenUsageTracker.startTurn(turnsRun);

  let currentObservation: MgbaObservation | undefined;
  const observedInput = await createObservedTurnInput({
    client: mgbaClient,
    onObservation: async (observation) => {
      currentObservation = observation;
      stuckMemory.observe(observation, turnsRun);
      runMetricsTracker.recordStuckEvents(stuckMemory.snapshot().stuckEvents);
      prettyLogger.observationInjection({
        nextTurn: turnsRun,
        observation,
      });
      await viewerEventRecorder.recordObservation(turnsRun, observation);
    },
    recentActions,
    stuckMemory: stuckMemory.snapshot(),
    turn: turnsRun,
  });
  if (currentObservation) {
    const milestone = milestoneTracker.observe(currentObservation);
    if (
      milestone.furthest &&
      milestone.furthest !== runTrace.milestoneFurthest
    ) {
      runTrace = await updateRunTraceMetadata(runTrace, {
        milestone: milestone.furthest,
        milestoneCurrent: milestone.current ?? undefined,
        milestoneFurthest: milestone.furthest,
      });
    }
  }
  const run = await session.send(observedInput);
  await streamSupervisedRun({
    client: mgbaClient,
    onEvent: (event) => {
      runMetricsTracker.recordEvent(event);
      if (currentObservation && event.type === "tool-call") {
        stuckMemory.recordEvent(event, currentObservation, turnsRun);
      }
      recordRecentAction(event, recentActions);
      prettyLogger.event(event as never);
      fireAndReportViewerWrite(
        viewerEventRecorder.recordEvent(event, { turn: turnsRun })
      );
    },
    run,
  });
  await tokenUsageTracker.endTurn();
  await persistRunMetricsMetadata();
}

function recordRecentAction(event: unknown, recentActions: string[]): void {
  if (!isControlToolCall(event)) {
    return;
  }

  recentActions.push(formatAction(event.toolName, event.input));
  recentActions.splice(0, Math.max(0, recentActions.length - 10));
}

function isControlToolCall(
  event: unknown
): event is { input: unknown; toolName: string; type: "tool-call" } {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    event.type === "tool-call" &&
    "toolName" in event &&
    typeof event.toolName === "string" &&
    [
      "mgba_tap",
      "mgba_tap_many",
      "mgba_hold",
      "mgba_hold_many",
      "mgba_release",
    ].includes(event.toolName)
  );
}

function formatAction(toolName: string, input: unknown): string {
  return `${toolName.replace("mgba_", "")}: ${JSON.stringify(input)}`;
}

async function persistRunMetricsMetadata(): Promise<void> {
  const snapshot = runMetricsTracker.snapshot();
  if (
    snapshot.stuckEvents === runTrace.stuckEvents &&
    snapshot.supervisorInterventions === runTrace.supervisorInterventions
  ) {
    return;
  }

  runTrace = await updateRunTraceMetadata(runTrace, {
    stuckEvents: snapshot.stuckEvents,
    supervisorInterventions: snapshot.supervisorInterventions,
  });
}

function fireAndReportViewerWrite(write: Promise<void>): void {
  write.catch((error: unknown) => {
    console.dir({
      message: error instanceof Error ? error.message : String(error),
      type: "viewer-recorder-error",
    });
  });
}
