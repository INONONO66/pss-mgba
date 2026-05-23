import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent } from "@minpeter/pss-runtime";
import { env } from "./env";

const provider = createOpenAICompatible({
  name: "openai-compatible",
  apiKey: env.AI_API_KEY,
  baseURL: env.AI_BASE_URL,
});

const agent = await Agent.create({
  instructions: "Keep every answer under 3 lines.",
  model: provider(env.AI_MODEL),
});

const run = await agent.send("Find information about minpeter.");
for await (const event of run.stream()) {
  console.dir(event, { depth: null });
}
