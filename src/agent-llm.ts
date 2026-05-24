import type { RuntimeLlm } from "@minpeter/pss-runtime";
import { generateText, type LanguageModel, type ToolSet } from "ai";

const LLM_MAX_ATTEMPTS = 3;

export type ReasoningEffort =
  | "provider-default"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

interface CreateReasoningLlmOptions {
  generateTextImpl?: typeof generateText;
  instructions: string;
  model: LanguageModel;
  reasoning: ReasoningEffort;
  sleep?: (ms: number) => Promise<void>;
  tools: ToolSet;
}

export function createReasoningLlm({
  generateTextImpl = generateText,
  instructions,
  model,
  reasoning,
  sleep = defaultSleep,
  tools,
}: CreateReasoningLlmOptions): RuntimeLlm {
  return async ({ history, signal }) => {
    for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt += 1) {
      try {
        const { responseMessages } = await generateTextImpl({
          abortSignal: signal,
          instructions,
          messages: [...history],
          model,
          reasoning,
          tools,
        });

        return responseMessages;
      } catch (error) {
        if (attempt >= LLM_MAX_ATTEMPTS || !isTransientLlmError(error)) {
          throw error;
        }
        await sleep(100 * 2 ** (attempt - 1));
      }
    }

    throw new Error("LLM retry loop exhausted unexpectedly");
  };
}

export function isTransientLlmError(error: unknown): boolean {
  if (isAbortError(error)) {
    return false;
  }

  const status =
    readNumericProperty(error, "status") ??
    readNumericProperty(error, "statusCode");
  if (typeof status === "number") {
    return (
      status === 408 ||
      status === 409 ||
      status === 425 ||
      status === 429 ||
      status >= 500
    );
  }

  const code = readStringProperty(error, "code");
  return (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_SOCKET"
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function readNumericProperty(error: unknown, key: string): number | undefined {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return;
  }
  const value = error[key as keyof typeof error];
  return typeof value === "number" ? value : undefined;
}

function readStringProperty(error: unknown, key: string): string | undefined {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return;
  }
  const value = error[key as keyof typeof error];
  return typeof value === "string" ? value : undefined;
}
