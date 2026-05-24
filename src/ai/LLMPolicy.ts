import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import type { HarnessConfig, HarnessMode, LlmVisionDetail } from "../config.js";
import type { PolicyDecision } from "../control/ActionTypes.js";
import { PolicyDecisionSchema, createPolicyDecisionJsonSchema } from "../control/ActionSchema.js";
import { HarnessError } from "../errors.js";
import type { Policy, PolicyInput, VisionImageInput } from "./Policy.js";

interface ChatMessage {
  content: string | null;
}

export type ChatCompletionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: LlmVisionDetail } };

type ChatCompletionRequestMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ChatCompletionContentPart[] };

interface ChatChoice {
  message?: ChatMessage;
}

interface ChatCompletionResult {
  choices: ChatChoice[];
}

export interface ChatCompletionsClient {
  chat: {
    completions: {
      create(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
    };
  };
}

export interface ChatCompletionRequest {
  model: string;
  temperature: number;
  messages: ChatCompletionRequestMessage[];
}

export interface LLMConversationTrace {
  readonly call: number;
  readonly model: string;
  readonly temperature: number;
  readonly harnessMode: HarnessMode;
  readonly messages: readonly SanitizedChatCompletionRequestMessage[];
  readonly responseContent?: string;
  readonly parsedDecision?: PolicyDecision;
  readonly error?: { readonly code: string; readonly message: string };
}

type SanitizedChatCompletionRequestMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string | SanitizedChatCompletionContentPart[] };

type SanitizedChatCompletionContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string; readonly detail?: LlmVisionDetail } };

export interface OpenAIClientOptions {
  apiKey: string;
  baseURL: string;
  timeout: number;
  maxRetries: number;
}

export interface LLMPolicyOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  temperature: number;
  maxLlmCalls: number;
  harnessMode?: HarnessMode;
  visionDetail?: LlmVisionDetail;
  visionRequired?: boolean;
  fallbackPolicy: Policy;
  client?: ChatCompletionsClient;
  createClient?: (options: OpenAIClientOptions) => ChatCompletionsClient;
  onFallback?: (error: HarnessError) => void;
  onConversation?: (conversation: LLMConversationTrace) => void | Promise<void>;
}

export class LLMPolicy implements Policy {
  private readonly client: ChatCompletionsClient;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxLlmCalls: number;
  private readonly harnessMode: HarnessMode;
  private readonly visionDetail: LlmVisionDetail;
  private readonly visionRequired: boolean;
  private readonly fallbackPolicy: Policy;
  private readonly onFallback?: (error: HarnessError) => void;
  private readonly onConversation?: (conversation: LLMConversationTrace) => void | Promise<void>;
  private calls = 0;

  constructor(options: LLMPolicyOptions) {
    this.client = options.client ?? (options.createClient ?? createOpenAIClient)({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries
    });
    this.model = options.model;
    this.temperature = options.temperature;
    this.maxLlmCalls = options.maxLlmCalls;
    this.harnessMode = options.harnessMode ?? "stage1";
    this.visionDetail = options.visionDetail ?? "low";
    this.visionRequired = options.visionRequired ?? false;
    this.fallbackPolicy = options.fallbackPolicy;
    this.onFallback = options.onFallback;
    this.onConversation = options.onConversation;
  }

  static fromConfig(config: HarnessConfig, fallbackPolicy: Policy, overrides: Partial<Pick<LLMPolicyOptions, "client" | "createClient" | "onFallback" | "onConversation">> = {}): LLMPolicy {
    const providerOptions = getProviderOptions(config);

    return new LLMPolicy({
      apiKey: providerOptions.apiKey,
      baseURL: providerOptions.baseURL,
      model: providerOptions.model,
      timeoutMs: config.llmTimeoutMs,
      maxRetries: config.llmMaxRetries,
      temperature: config.openaiTemperature,
      maxLlmCalls: config.maxLlmCalls,
      harnessMode: config.harnessMode,
      visionDetail: config.llmVisionDetail,
      visionRequired: config.llmVisionEnabled,
      fallbackPolicy,
      ...overrides
    });
  }

  getCallCount(): number {
    return this.calls;
  }

  async chooseAction(input: PolicyInput): Promise<PolicyDecision> {
    if (this.calls >= this.maxLlmCalls) {
      return this.fallback(input, new HarnessError("BUDGET_EXCEEDED", "Maximum LLM call budget reached", {
        context: { maxLlmCalls: this.maxLlmCalls }
      }));
    }

    this.calls += 1;

    try {
      if (this.visionRequired && (input.visionImages === undefined || input.visionImages.length === 0)) {
        return this.fallback(input, new HarnessError("LLM_UNAVAILABLE", "LLM vision input is required but no processed vision images were available"));
      }

      const call = this.calls;
      const messages = await buildMessages(input, this.harnessMode, this.visionDetail);
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: this.temperature,
        messages
      });
      const content = completion.choices[0]?.message?.content;

      if (typeof content !== "string" || content.trim().length === 0) {
        await this.recordConversation({ call, messages, error: new HarnessError("LLM_INVALID_OUTPUT", "LLM response did not include message content") });
        return this.fallback(input, new HarnessError("LLM_INVALID_OUTPUT", "LLM response did not include message content"));
      }

      let decision: PolicyDecision;
      try {
        decision = parseDecision(content);
      } catch (error) {
        const harnessError = error instanceof HarnessError
          ? error
          : new HarnessError("LLM_INVALID_OUTPUT", "LLM response could not be parsed", { cause: error });
        await this.recordConversation({ call, messages, responseContent: content, error: harnessError });
        return this.fallback(input, harnessError);
      }
      await this.recordConversation({ call, messages, responseContent: content, parsedDecision: decision });
      return decision;
    } catch (error) {
      if (error instanceof HarnessError) {
        // If this was thrown after receiving content (e.g. invalid JSON/schema),
        // the fallback path still captures a concise error through the caller.
        return this.fallback(input, error);
      }

      return this.fallback(input, new HarnessError("LLM_UNAVAILABLE", "OpenAI-compatible chat completion failed", {
        cause: error,
        context: { provider: "openai-chat-completions" }
      }));
    }
  }

  private async fallback(input: PolicyInput, error: HarnessError): Promise<PolicyDecision> {
    this.onFallback?.(error);
    const decision = await this.fallbackPolicy.chooseAction(input);
    return markFallbackDecision(decision, error.code);
  }

  private async recordConversation(input: {
    readonly call: number;
    readonly messages: ChatCompletionRequestMessage[];
    readonly responseContent?: string;
    readonly parsedDecision?: PolicyDecision;
    readonly error?: HarnessError;
  }): Promise<void> {
    if (this.onConversation === undefined) return;

    await this.onConversation({
      call: input.call,
      model: this.model,
      temperature: this.temperature,
      harnessMode: this.harnessMode,
      messages: sanitizeMessages(input.messages),
      responseContent: input.responseContent,
      parsedDecision: input.parsedDecision,
      ...(input.error !== undefined ? { error: { code: input.error.code, message: input.error.message } } : {})
    });
  }
}

function getProviderOptions(config: HarnessConfig): Pick<LLMPolicyOptions, "apiKey" | "baseURL" | "model"> {
  if (config.openaiApiKey === undefined) {
    throw new HarnessError("LLM_UNAVAILABLE", "OPENAI_API_KEY is required when AI_PROVIDER=openai");
  }

  return {
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl,
    model: config.openaiModel
  };
}

function markFallbackDecision(decision: PolicyDecision, code: string): PolicyDecision {
  const marker = `LLM fallback after ${code}`;
  const markedDecision: PolicyDecision = {
    ...decision,
    rationale: `${marker}: ${decision.rationale}`.slice(0, 500),
    observedStateCitations: [marker, ...decision.observedStateCitations].slice(0, 5)
  };

  return PolicyDecisionSchema.parse(markedDecision);
}

function sanitizeMessages(messages: ChatCompletionRequestMessage[]): SanitizedChatCompletionRequestMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content } as SanitizedChatCompletionRequestMessage;
    }

    return {
      role: "user",
      content: message.content.map((part) => {
        if (part.type === "text") {
          return part;
        }

        const [metadata] = part.image_url.url.split(",", 1);
        const prefix = metadata?.includes(";base64") === true ? metadata : `${metadata ?? "data:image"};base64`;
        return {
          type: "image_url",
          image_url: {
            url: `${prefix},[omitted]`,
            detail: part.image_url.detail
          }
        };
      })
    };
  });
}

function createOpenAIClient(options: OpenAIClientOptions): ChatCompletionsClient {
  return new OpenAI(options);
}

async function buildMessages(input: PolicyInput, harnessMode: HarnessMode, defaultVisionDetail: LlmVisionDetail): Promise<ChatCompletionRequest["messages"]> {
  const userText = harnessMode === "full-game" ? buildFullGameUserText(input) : buildStage1UserText(input);
  const userContent = await buildUserContent(userText, input.visionImages, defaultVisionDetail);

  if (harnessMode === "full-game") {
    return [
      {
        role: "system",
        content: "You are a Pokemon Red/Blue full-game controller for an mGBA harness. Choose only safe Game Boy actions from the supplied schema. Never invent buttons, memory writes, emulator RAM mutation, shell commands, code execution, ROM assets, walkthrough text, or a hardcoded global input timeline."
      },
      {
        role: "user",
        content: userContent
      }
    ];
  }

  return [
    {
      role: "system",
      content: "You are a bounded Pokemon Red/Blue controller. Choose only safe Game Boy actions from the supplied schema. Never invent buttons, memory writes, shell commands, code execution, or a hardcoded global input timeline."
    },
    {
      role: "user",
      content: userContent
    }
  ];
}

function buildStage1UserText(input: PolicyInput): string {
  return [
    "Task: choose the next safe Game Boy controller action.",
    "Goal: make forward game progress using only the current observed game state.",
    ...buildStateContextSection(input),
    `Recent actions summary: ${stableJson(input.recentActions ?? input.recentStates ?? [])}`,
    ...buildMapSection(input),
    outputContract()
  ].join("\n");
}

function buildFullGameUserText(input: PolicyInput): string {
  return [
    "Task: choose the next safe Game Boy controller action.",
    "Goal: progress through the game autonomously using only observed state and legal inputs.",
    "Completion rule: only observed Hall of Fame map/state completes the run; badges alone do not.",
    ...buildStateContextSection(input),
    `Recent actions summary: ${stableJson(input.recentActions ?? input.recentStates ?? [])}`,
    ...buildMapSection(input),
    outputContract()
  ].join("\n");
}

async function buildUserContent(text: string, visionImages: readonly VisionImageInput[] | undefined, defaultDetail: LlmVisionDetail): Promise<string | ChatCompletionContentPart[]> {
  if (visionImages === undefined || visionImages.length === 0) {
    return text;
  }

  const parts: ChatCompletionContentPart[] = [{ type: "text", text }];
  for (const image of visionImages) {
    const bytes = await readFile(image.path);
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${image.mediaType};base64,${bytes.toString("base64")}`,
        detail: image.detail ?? defaultDetail
      }
    });
  }

  return parts;
}

function buildStateContextSection(input: PolicyInput): string[] {
  const lines: string[] = [];

  if (input.objective !== undefined) {
    lines.push(`Objective: ${input.objective}`);
  }

  if (input.detectorStatus !== undefined) {
    lines.push(`Progress: ${formatDetectorStatus(input.detectorStatus)}`);
  }

  if (input.fullStateSummary !== undefined) {
    lines.push(
      "Game state:",
      input.fullStateSummary
    );
  } else if (input.fullStateError !== undefined) {
    lines.push(`Full game state unavailable this step: ${input.fullStateError}`);
  } else {
    lines.push(`Fallback RAM state: ${stableJson(input.currentState ?? input.state)}`);
  }

  return lines;
}

function formatDetectorStatus(status: unknown): string {
  if (status === undefined || status === null || typeof status !== "object") {
    return stableJson(status);
  }

  const record = status as Record<string, unknown>;
  return stableJson({
    status: record.status,
    checkpoints: record.checkpoints,
    lastObserved: record.lastObserved
  });
}

function buildMapSection(input: PolicyInput): string[] {
  const lines: string[] = [];

  if (input.mapStateError !== undefined) {
    lines.push(`Map context unavailable this step: ${input.mapStateError}`);
  }

  if (input.mapStateWarning !== undefined) {
    lines.push(`Map context warning: ${input.mapStateWarning}`);
  }

  if (input.mapAscii) {
    lines.push(
      "Current map (ASCII grid — .=walkable #=wall \"=grass ?=unseen @=you N=NPC W=warp):",
      input.mapAscii,
    );
  }

  if (input.mapTileCount !== undefined && input.mapTotalTiles !== undefined && input.mapTotalTiles > 0) {
    lines.push(`Map coverage: ${input.mapTileCount}/${input.mapTotalTiles} tiles explored.`);
  }

  if (input.visitedMaps !== undefined && input.visitedMaps.length > 0) {
    lines.push(`Visited map IDs this session: [${input.visitedMaps.join(", ")}]`);
  }

  if (input.walkGrid) {
    const { grid, width, height } = input.walkGrid;
    const state = input.state ?? input.currentState as Record<string, unknown> | undefined;
    const py = (state as Record<string, unknown> | undefined)?.wYCoord as number | undefined;
    const px = (state as Record<string, unknown> | undefined)?.wXCoord as number | undefined;

    if (py !== undefined && px !== undefined) {
      const nearby: string[] = [];
      for (const [dy, dx, dir] of [[- 1, 0, "Up"], [1, 0, "Down"], [0, -1, "Left"], [0, 1, "Right"]] as const) {
        const ny = py + dy;
        const nx = px + dx;
        const passable = ny >= 0 && ny < height && nx >= 0 && nx < width && grid[ny][nx];
        nearby.push(`${dir}:${passable ? "open" : "blocked"}`);
      }
      lines.push(`Adjacent tiles: ${nearby.join(", ")}`);
    }
  }

  return lines;
}

function outputContract(): string {
  return [
    "Rules:",
    "- Use only controller actions; no memory writes, emulator APIs, shell commands, or hardcoded global input timelines.",
    "- Base the action on the current observed state, current map/position, recent actions, and screenshot if present.",
    "- Do not rely on guidebook walkthrough steps or route scripts; infer from the live state.",
    `Output schema: ${stableJson(createPolicyDecisionJsonSchema())}`,
    "Output only one JSON object. No markdown or extra text."
  ].join("\n");
}

function parseDecision(content: string): PolicyDecision {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new HarnessError("LLM_INVALID_OUTPUT", "LLM response was not valid JSON", { cause: error });
  }

  const normalized = normalizePolicyDecisionCandidate(parsed);
  const result = PolicyDecisionSchema.safeParse(normalized);
  if (!result.success) {
    throw new HarnessError("LLM_INVALID_OUTPUT", "LLM response failed policy decision schema validation", {
      context: { issues: result.error.issues.map((issue) => issue.message) }
    });
  }

  return result.data;
}

function normalizePolicyDecisionCandidate(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  return {
    action: normalizeHarnessActionCandidate(candidate.action),
    rationale: typeof candidate.rationale === "string" ? candidate.rationale.slice(0, 500) : candidate.rationale,
    confidence: normalizeConfidenceCandidate(candidate.confidence),
    observedStateCitations: Array.isArray(candidate.observedStateCitations)
      ? candidate.observedStateCitations.filter((citation): citation is string => typeof citation === "string").slice(0, 5)
      : candidate.observedStateCitations
  };
}

function normalizeHarnessActionCandidate(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const action = value as Record<string, unknown>;
  switch (action.type) {
    case "press":
    case "hold":
      return {
        type: action.type,
        button: action.button,
        frames: normalizeFrameCandidate(action.frames)
      };
    case "wait":
      return {
        type: action.type,
        frames: normalizeFrameCandidate(action.frames)
      };
    case "sequence":
      return {
        type: action.type,
        actions: Array.isArray(action.actions) ? action.actions.slice(0, 8).map(normalizeHarnessActionCandidate) : action.actions
      };
    default:
      return value;
  }
}

function normalizeConfidenceCandidate(value: unknown): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return value;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeFrameCandidate(value: unknown): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return value;
  }

  return Math.max(1, Math.min(60, Math.trunc(value)));
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry === "bigint") {
      return entry.toString();
    }

    return entry;
  });
}
