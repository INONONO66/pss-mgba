import path from "node:path";
import {
  Agent,
  type AgentEvent,
  type UserMessageContentPart,
} from "@minpeter/pss-runtime";
import { FileSessionStore } from "@minpeter/pss-runtime/session-store/file";
import type { LanguageModel } from "ai";
import {
  createDynamicLlm,
  type DynamicLlmContext,
  type DynamicReasoningEffort,
} from "./dynamic-llm.js";

export interface AgentBridgeInput {
  readonly contextProvider: () => DynamicLlmContext;
  readonly evidenceDir: string;
  readonly model: LanguageModel;
  readonly reasoning?: DynamicReasoningEffort;
  readonly runId: string;
  readonly sessionDirectory: string;
  readonly sessionKey: string;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface AgentBridgeRun {
  stream(): AsyncIterable<AgentEvent>;
}

export interface AgentBridgeSession {
  interrupt(): void;
  sendUserMessage(
    content: readonly UserMessageContentPart[]
  ): Promise<AgentBridgeRun>;
}

/** Bridges the runtime Agent session to the session-owned harness loop. */
export async function createAgentBridgeSession(
  input: AgentBridgeInput
): Promise<AgentBridgeSession> {
  const agent = await Agent.create({
    llm: createDynamicLlm({
      getContext: input.contextProvider,
      model: input.model,
      reasoning: input.reasoning,
      sleep: input.sleep,
    }),
    sessions: {
      store: new FileSessionStore(
        path.join(input.evidenceDir, input.runId, input.sessionDirectory)
      ),
    },
  });
  const session = agent.session(input.sessionKey);

  return {
    interrupt() {
      session.interrupt();
    },
    sendUserMessage(
      content: readonly UserMessageContentPart[]
    ): Promise<AgentBridgeRun> {
      return session.send({ type: "user-message", content });
    },
  };
}
