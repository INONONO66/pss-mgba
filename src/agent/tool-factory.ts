import type { AgentTools } from "@minpeter/pss-runtime";
import type { GameMode } from "../control/CommandTypes.js";
import type { AgentMemoryStore } from "./AgentMemoryStore.js";
import type { CommandAgentContext } from "./CommandAgentContext.js";
import { createCommandTools } from "./command-tools.js";
import { createMemoryTools } from "./memory-tools.js";
import { createSaveLoadTools } from "./saveload-tools.js";

export interface ToolFactoryInput {
  readonly context: CommandAgentContext;
  readonly memoryStore: AgentMemoryStore;
  readonly modeProvider: () => GameMode;
  readonly rollbackProgressProvider: () => number;
}

/**
 * Single construction point for runtime tools.
 *
 * Tool availability is still resolved separately from SessionState; this factory
 * only assembles the full registry so callers cannot accidentally omit memory,
 * save/load, or session-routed command tools.
 */
export class ToolFactory {
  private readonly input: ToolFactoryInput;

  constructor(input: ToolFactoryInput) {
    this.input = input;
  }

  createTools(): AgentTools {
    return {
      ...createCommandTools(this.input.context),
      ...createMemoryTools(this.input.memoryStore),
      ...createSaveLoadTools(
        this.input.context.client,
        this.input.modeProvider,
        this.input.memoryStore,
        this.input.rollbackProgressProvider
      ),
    } satisfies AgentTools;
  }
}

export function createAgentTools(input: ToolFactoryInput): AgentTools {
  return new ToolFactory(input).createTools();
}
