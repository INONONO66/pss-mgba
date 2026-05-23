import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent, type AgentInput } from "@minpeter/pss-runtime";
import { env } from "./env";
import { startMetricsServer } from "./metrics-server";
import { MgbaHttpClient } from "./mgba-http";
import { createPrettyLogger } from "./pretty-log";
import { createRunTrace } from "./run-trace";
import {
  createObservedContinuationInput,
  POKEMON_OBJECTIVE_PROMPT,
  streamRun,
} from "./runner";
import { createTrackedModel, TokenUsageTracker } from "./token-usage";
import { createMgbaControlPlane, describeMgbaControlPlane } from "./tools";

const provider = createOpenAICompatible({
  name: "openai-compatible",
  apiKey: env.AI_API_KEY,
  baseURL: env.AI_BASE_URL,
});

const instructions = [
  "You are a concise Pokemon-playing control agent.",
  describeMgbaControlPlane(),
  "When playing autonomously, use a loop of injected observation -> decide -> one action -> brief summary.",
  "Keep final user-facing answers under 3 lines, but use tools whenever game control is requested.",
].join("\n\n");
const mgbaClient = new MgbaHttpClient({ baseUrl: env.MGBA_HTTP_BASE_URL });
const tools = createMgbaControlPlane({
  client: mgbaClient,
  includeObservationTools: false,
});
const runTrace = await createRunTrace();
const prettyLogger = createPrettyLogger();
prettyLogger.runTrace(runTrace);
const tokenUsageTracker = new TokenUsageTracker({
  iteration: runTrace.iteration,
  metricsDir: runTrace.metricsDir,
  runId: runTrace.runId,
  onMetric: prettyLogger.tokenUsage,
});

startMetricsServer(tokenUsageTracker, {
  host: env.METRICS_HTTP_HOST,
  port: env.METRICS_HTTP_PORT,
});

const agent = await Agent.create({
  instructions,
  model: createTrackedModel({
    model: provider(env.AI_MODEL),
    tracker: tokenUsageTracker,
  }),
  tools,
});

const session = agent.session("pokemon-run");
let prompt: AgentInput = POKEMON_OBJECTIVE_PROMPT;
let turnsRun = 0;

while (true) {
  turnsRun += 1;
  tokenUsageTracker.startTurn(turnsRun);

  const run = await session.send(prompt);
  await streamRun(run, prettyLogger.event);
  await tokenUsageTracker.endTurn();

  prompt = await createObservedContinuationInput({
    client: mgbaClient,
    turn: turnsRun,
  });
}
