import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { PolicyDecision } from "../../src/control/ActionTypes.js";
import { LLMPolicy, type ChatCompletionRequest, type ChatCompletionsClient, type LLMConversationTrace, type OpenAIClientOptions } from "../../src/ai/LLMPolicy.js";
import type { Policy, PolicyInput } from "../../src/ai/Policy.js";
import { HarnessError } from "../../src/errors.js";

const validDecision: PolicyDecision = {
  action: { type: "press", button: "A", frames: 5 },
  rationale: "Advance current dialog based on observed text state.",
  confidence: 0.8,
  observedStateCitations: ["wTextBoxID=1", "wIsInBattle=0"]
};

const fallbackDecision: PolicyDecision = {
  action: { type: "wait", frames: 1 },
  rationale: "Fallback waits safely after invalid LLM output.",
  confidence: 0.2,
  observedStateCitations: ["fallback=true"]
};

const policyInput: PolicyInput = {
  state: {
    frame: 12,
    wIsInBattle: 0,
    wTextBoxID: 1,
    wPartyCount: 0,
    coords: { x: 3, y: 6 }
  },
  recentActions: [{ action: { type: "press", button: "A", frames: 5 }, result: "advanced text" }],
  step: 7
};

const enrichedPolicyInput: PolicyInput = {
  ...policyInput,
  objective: "Stage 1: acquire starter and exit rival battle.",
  detectorStatus: { status: "running", checkpoints: { initialObserved: true, completed: false } },
  fullStateSummary: "GAME STATE\nLocation  : Reds House 2f (map 38)\nMoney     : $3000",
  fullState: {
    player: {
      name: "AAAAAAA",
      rivalName: "AAAAAAA",
      money: 3000,
      position: { mapId: 38, y: 3, x: 3, yBlock: 1, xBlock: 1 },
      facing: { raw: 8, direction: "left" },
      badges: { raw: 0, count: 0, obtained: [false, false, false, false, false, false, false, false], names: [] },
      playTime: "1:38:18.22"
    },
    map: { mapId: 38, mapName: "Reds House 2f", tilesetId: 4, width: 4, height: 4 },
    party: { count: 0, members: [] },
    bag: [],
    battle: { inBattle: false, type: "none" },
    dialog: { active: false, textBoxId: 13, letterPrintingDelayFlags: 1, joyIgnore: 0 },
    flags: {
      hasPokedex: false,
      hasOaksParcel: false,
      deliveredOaksParcel: false,
      pokedexOwned: 0,
      pokedexSeen: 0,
      badges: { raw: 0, count: 0, obtained: [false, false, false, false, false, false, false, false], names: [] }
    },
    menuText: {
      currentMenuItem: 2,
      textBoxId: 13,
      letterPrintingDelayFlags: 1,
      screenText: "",
      screenTextKind: "none",
      namingScreenNameLength: 7,
      namingScreenSubmitName: 1,
      namingScreenType: 1
    }
  }
};

describe("LLMPolicy", () => {
  it("accepts valid model JSON and sends the configured model in a Chat Completions request", async () => {
    const requests: ChatCompletionRequest[] = [];
    const client = fakeClient(async (request) => {
      requests.push(request);
      return JSON.stringify(validDecision);
    });
    const policy = createPolicy({ client });

    await expect(policy.chooseAction(policyInput)).resolves.toEqual(validDecision);

    expect(policy.getCallCount()).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: "unit-test-model", temperature: 0.1 });
    expect(requests[0]?.messages[0]?.role).toBe("system");
    const prompt = getUserText(requests[0]);
    expect(prompt).toContain("Fallback RAM state");
    expect(prompt).toContain("Goal: make forward game progress using only the current observed game state.");
    expect(prompt).toContain("Do not rely on guidebook walkthrough steps or route scripts");
    expect(prompt).toContain("Output only one JSON object");
    expect(prompt).toContain("Output schema");
    expect(prompt).not.toContain("Stage 1 route facts");
    expect(prompt).not.toContain("Red House 2F map 38");
  });

  it("keeps text-only requests as string content when no vision images are provided", async () => {
    const requests: ChatCompletionRequest[] = [];
    const client = fakeClient(async (request) => {
      requests.push(request);
      return JSON.stringify(validDecision);
    });
    const policy = createPolicy({ client });

    await expect(policy.chooseAction(policyInput)).resolves.toEqual(validDecision);

    expect(typeof requests[0]?.messages[1]?.content).toBe("string");
    expect(JSON.stringify(requests[0])).not.toContain("data:image");
  });

  it("does not send a text-only request when config requires vision images", async () => {
    const requests: ChatCompletionRequest[] = [];
    const fallbackErrors: HarnessError[] = [];
    const client = fakeClient(async (request) => {
      requests.push(request);
      return JSON.stringify(validDecision);
    });
    const config = loadConfig({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "unit-test-key",
      LLM_VISION_ENABLED: "true"
    });
    const policy = LLMPolicy.fromConfig(config, createFallbackPolicy(), {
      client,
      onFallback(error) {
        fallbackErrors.push(error);
      }
    });

    const decision = await policy.chooseAction(policyInput);

    expect(requests).toHaveLength(0);
    expect(fallbackErrors).toHaveLength(1);
    expect(fallbackErrors[0]).toMatchObject({ code: "LLM_UNAVAILABLE" });
    expect(decision.rationale).toContain("LLM fallback after LLM_UNAVAILABLE");
    expect(JSON.stringify(decision)).not.toContain("data:image");
  });

  it("builds transient multimodal content parts from provided vision images", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "llm-policy-vision-"));
    const imagePath = path.join(root, "frame.jpg");
    await writeFile(imagePath, Buffer.from([1, 2, 3, 4]));
    const requests: ChatCompletionRequest[] = [];
    const client = fakeClient(async (request) => {
      requests.push(request);
      return JSON.stringify(validDecision);
    });
    const policy = createPolicy({ client, visionDetail: "high" });

    await expect(policy.chooseAction({
      ...policyInput,
      visionImages: [{
        path: imagePath,
        sourcePath: "/tmp/source.png",
        mediaType: "image/jpeg",
        width: 2,
        height: 2,
        step: 7,
        frame: 12,
        crop: { left: 0, top: 0, width: 2, height: 2 },
        bytes: 4,
        detail: "low"
      }]
    })).resolves.toEqual(validDecision);

    const content = requests[0]?.messages[1]?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) {
      throw new Error("expected multimodal content parts");
    }
    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Fallback RAM state") });
    const imagePart = content[1];
    expect(imagePart).toMatchObject({
      type: "image_url",
      image_url: { detail: "low" }
    });
    if (imagePart?.type !== "image_url") {
      throw new Error("expected image content part");
    }
    expect(decodeDataUrl(imagePart.image_url.url)).toEqual({ mediaType: "image/jpeg", bytes: Buffer.from([1, 2, 3, 4]) });
  });

  it("records sanitized LLM conversations without persisted image base64", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "llm-policy-conversation-"));
    const imagePath = path.join(root, "frame.jpg");
    await writeFile(imagePath, Buffer.from([9, 10, 11, 12]));
    const conversations: LLMConversationTrace[] = [];
    const policy = createPolicy({
      client: fakeClient(async () => JSON.stringify(validDecision)),
      onConversation: (conversation) => {
        conversations.push(conversation);
      }
    });

    await expect(policy.chooseAction({
      ...policyInput,
      visionImages: [{
        path: imagePath,
        sourcePath: "/tmp/source.png",
        mediaType: "image/jpeg",
        width: 2,
        height: 2,
        step: 7,
        frame: 12,
        crop: { left: 0, top: 0, width: 2, height: 2 },
        bytes: 4,
        detail: "low"
      }]
    })).resolves.toEqual(validDecision);

    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      call: 1,
      model: "unit-test-model",
      responseContent: JSON.stringify(validDecision),
      parsedDecision: validDecision
    });
    const serialized = JSON.stringify(conversations[0]);
    expect(serialized).toContain("data:image/jpeg;base64,[omitted]");
    expect(serialized).not.toContain("data:image/jpeg;base64;base64");
    expect(serialized).not.toContain(Buffer.from([9, 10, 11, 12]).toString("base64"));
  });

  it("records invalid raw LLM responses for dashboard debugging", async () => {
    const conversations: LLMConversationTrace[] = [];
    const fallbackErrors: HarnessError[] = [];
    const policy = createPolicy({
      client: fakeClient(async () => "not json"),
      onConversation: (conversation) => {
        conversations.push(conversation);
      },
      onFallback: (error) => fallbackErrors.push(error)
    });

    await expect(policy.chooseAction(policyInput)).resolves.toMatchObject({
      rationale: expect.stringContaining("LLM fallback after LLM_INVALID_OUTPUT")
    });

    expect(fallbackErrors.map((error) => error.code)).toEqual(["LLM_INVALID_OUTPUT"]);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      responseContent: "not json",
      error: { code: "LLM_INVALID_OUTPUT" }
    });
  });

  it("sends multimodal content when config requires vision and processed images are present", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "llm-policy-required-vision-"));
    const imagePath = path.join(root, "frame.jpg");
    await writeFile(imagePath, Buffer.from([5, 6, 7, 8]));
    const requests: ChatCompletionRequest[] = [];
    const client = fakeClient(async (request) => {
      requests.push(request);
      return JSON.stringify(validDecision);
    });
    const config = loadConfig({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "unit-test-key",
      LLM_VISION_ENABLED: "true"
    });
    const policy = LLMPolicy.fromConfig(config, createFallbackPolicy(), { client });

    await expect(policy.chooseAction({
      ...policyInput,
      visionImages: [{
        path: imagePath,
        sourcePath: "/tmp/source.png",
        mediaType: "image/jpeg",
        width: 2,
        height: 2,
        step: 7,
        frame: 12,
        crop: { left: 0, top: 0, width: 2, height: 2 },
        bytes: 4,
        detail: "low"
      }]
    })).resolves.toEqual(validDecision);

    const content = requests[0]?.messages[1]?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) {
      throw new Error("expected multimodal content parts");
    }
    expect(content).toHaveLength(2);
    const imagePart = content[1];
    expect(imagePart).toMatchObject({ type: "image_url" });
    if (imagePart?.type !== "image_url") {
      throw new Error("expected image content part");
    }
    expect(decodeDataUrl(imagePart.image_url.url)).toEqual({ mediaType: "image/jpeg", bytes: Buffer.from([5, 6, 7, 8]) });
  });

  it("keeps the base prompt state-driven without guidebook route facts or a global input timeline", async () => {
    const requests: ChatCompletionRequest[] = [];
    const client = fakeClient(async (request) => {
      requests.push(request);
      return JSON.stringify(validDecision);
    });
    const policy = createPolicy({ client });

    await expect(policy.chooseAction(policyInput)).resolves.toEqual(validDecision);

    const prompt = getUserText(requests[0]);
    expect(prompt).toContain("Base the action on the current observed state, current map/position, recent actions, and screenshot if present.");
    expect(prompt).toContain("Do not rely on guidebook walkthrough steps or route scripts");
    expect(prompt).toContain("Fallback RAM state");
    expect(prompt).toContain("Recent actions summary");
    expect(prompt).toContain("hardcoded global input timelines");
    expect(prompt).not.toContain("Stage 1 route facts");
    expect(prompt).not.toContain("Red House 2F");
    expect(prompt).not.toContain("Pallet map 0");
    expect(prompt).not.toContain("Oak Lab map 40");
    expect(prompt).not.toContain("SCRATCH is the damaging move to prefer");
    expect(prompt).not.toContain("step 1");
    expect(prompt).not.toContain("step 2");
    expect(prompt).not.toContain("step 3");
    expect(prompt.indexOf("Fallback RAM state")).toBeLessThan(prompt.indexOf("Recent actions summary"));
  });

  it("injects concise full game state summary, objective, and detector progress into the prompt", async () => {
    const requests: ChatCompletionRequest[] = [];
    const client = fakeClient(async (request) => {
      requests.push(request);
      return JSON.stringify(validDecision);
    });
    const policy = createPolicy({ client });

    await expect(policy.chooseAction(enrichedPolicyInput)).resolves.toEqual(validDecision);

    const prompt = getUserText(requests[0]);
    expect(prompt).toContain("Objective: Stage 1: acquire starter and exit rival battle.");
    expect(prompt).toContain("Progress:");
    expect(prompt).toContain("Game state:");
    expect(prompt).toContain("Location  : Reds House 2f");
    expect(prompt).not.toContain("Full game state JSON");
    expect(prompt).not.toContain("\"mapName\":\"Reds House 2f\"");
    expect(prompt.indexOf("Game state:")).toBeLessThan(prompt.indexOf("Recent actions summary"));
  });

  it("keeps the player prompt free of supervisor guidance", async () => {
    const requests: ChatCompletionRequest[] = [];
    const client = fakeClient(async (request) => {
      requests.push(request);
      return JSON.stringify(validDecision);
    });
    const policy = createPolicy({ client });

    await expect(policy.chooseAction(enrichedPolicyInput)).resolves.toEqual(validDecision);

    const prompt = getUserText(requests[0]);
    expect(prompt).not.toContain("Supervisor guidance:");
    expect(prompt).not.toContain("Active goal:");
    expect(prompt).toContain("Game state:");
    expect(prompt.indexOf("Game state:")).toBeLessThan(prompt.indexOf("Recent actions summary"));
  });

  it("uses a full-game prompt with Hall of Fame-only completion when configured", async () => {
    const requests: ChatCompletionRequest[] = [];
    const client = fakeClient(async (request) => {
      requests.push(request);
      return JSON.stringify(validDecision);
    });
    const policy = createPolicy({ client, harnessMode: "full-game" });

    await expect(policy.chooseAction(policyInput)).resolves.toEqual(validDecision);

    const prompt = getUserText(requests[0]);
    expect(prompt).toContain("Goal: progress through the game autonomously using only observed state and legal inputs.");
    expect(prompt).toContain("Completion rule: only observed Hall of Fame map/state completes the run; badges alone do not.");
    expect(prompt).toContain("no memory writes");
    expect(prompt).toContain("hardcoded global input timelines");
    expect(prompt).toContain("Do not rely on guidebook walkthrough steps or route scripts");
    expect(prompt).not.toContain("Stage 1 route facts");
  });

  it("passes baseURL, timeout, retry, and API key settings to the OpenAI-compatible client factory", async () => {
    const observedOptions: OpenAIClientOptions[] = [];
    const client = fakeClient(async () => JSON.stringify(validDecision));
    const config = loadConfig({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "unit-test-key",
      OPENAI_BASE_URL: "https://example.invalid/v1",
      OPENAI_MODEL: "configured-model",
      OPENAI_TEMPERATURE: "0.3",
      LLM_TIMEOUT_MS: "1234",
      LLM_MAX_RETRIES: "2",
      MAX_LLM_CALLS: "9"
    });

    const policy = LLMPolicy.fromConfig(config, createFallbackPolicy(), {
      createClient: (options) => {
        observedOptions.push(options);
        return client;
      }
    });

    await expect(policy.chooseAction(policyInput)).resolves.toEqual(validDecision);
    expect(observedOptions).toEqual([
      {
        apiKey: "unit-test-key",
        baseURL: "https://example.invalid/v1",
        timeout: 1234,
        maxRetries: 2
      }
    ]);
  });

  it("routes custom OpenAI-compatible base URLs through OPENAI settings", async () => {
    const observedOptions: OpenAIClientOptions[] = [];
    const requests: ChatCompletionRequest[] = [];
    const client = fakeClient(async (request) => {
      requests.push(request);
      return JSON.stringify(validDecision);
    });
    const config = loadConfig({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "provider-unit-test-key",
      OPENAI_BASE_URL: "https://codex.example.invalid/v1",
      OPENAI_MODEL: "codex-compatible-model"
    });

    const policy = LLMPolicy.fromConfig(config, createFallbackPolicy(), {
      createClient: (options) => {
        observedOptions.push(options);
        return client;
      }
    });

    await expect(policy.chooseAction(policyInput)).resolves.toEqual(validDecision);
    expect(observedOptions).toEqual([{
      apiKey: "provider-unit-test-key",
      baseURL: "https://codex.example.invalid/v1",
      timeout: 20000,
      maxRetries: 1
    }]);
    expect(requests[0]).toMatchObject({ model: "codex-compatible-model" });
  });

  it("normalizes harmless model schema drift without accepting unsafe actions", async () => {
    const requests: ChatCompletionRequest[] = [];
    const overlongRationale = "Advance dialog. ".repeat(80);
    const client = fakeClient(async (request) => {
      requests.push(request);
      return JSON.stringify({
        ...validDecision,
        action: { type: "press", button: "A", frames: 90.7, comment: "extra model field" },
        rationale: overlongRationale,
        confidence: 1.4,
        observedStateCitations: ["wTextBoxID=1", 12, "wIsInBattle=0", "screenTextKind=dialog", "coords=38:3:3", "recentAction=A", "extra=trimmed"],
        commentary: "extra top-level model field"
      });
    });
    const policy = createPolicy({ client });

    await expect(policy.chooseAction(policyInput)).resolves.toEqual({
      action: { type: "press", button: "A", frames: 60 },
      rationale: overlongRationale.slice(0, 500),
      confidence: 1,
      observedStateCitations: ["wTextBoxID=1", "wIsInBattle=0", "screenTextKind=dialog", "coords=38:3:3", "recentAction=A"]
    });
    expect(requests).toHaveLength(1);
  });

  it("falls back on malformed JSON and invalid model-invented buttons", async () => {
    const fallbackErrors: HarnessError[] = [];
    const malformedPolicy = createPolicy({
      client: fakeClient(async () => "not json"),
      onFallback: (error) => fallbackErrors.push(error)
    });
    const invalidButtonPolicy = createPolicy({
      client: fakeClient(async () => JSON.stringify({ ...validDecision, action: { type: "press", button: "L", frames: 5 } })),
      onFallback: (error) => fallbackErrors.push(error)
    });

    await expect(malformedPolicy.chooseAction(policyInput)).resolves.toMatchObject({
      ...fallbackDecision,
      rationale: expect.stringContaining("LLM fallback after LLM_INVALID_OUTPUT"),
      observedStateCitations: expect.arrayContaining(["LLM fallback after LLM_INVALID_OUTPUT"])
    });
    await expect(invalidButtonPolicy.chooseAction(policyInput)).resolves.toMatchObject({
      ...fallbackDecision,
      rationale: expect.stringContaining("LLM fallback after LLM_INVALID_OUTPUT"),
      observedStateCitations: expect.arrayContaining(["LLM fallback after LLM_INVALID_OUTPUT"])
    });

    expect(fallbackErrors.map((error) => error.code)).toEqual(["LLM_INVALID_OUTPUT", "LLM_INVALID_OUTPUT"]);
  });

  it("falls back on endpoint-style failures without exposing request secrets", async () => {
    const fallbackErrors: HarnessError[] = [];
    const failures = [
      new Error("timeout while reading completion"),
      new Error("401 unauthorized"),
      new Error("429 rate limited"),
      new Error("500 upstream error"),
      new TypeError("fetch failed")
    ];

    for (const failure of failures) {
      const policy = createPolicy({
        client: fakeClient(async () => {
          throw failure;
        }),
        onFallback: (error) => fallbackErrors.push(error)
      });

      await expect(policy.chooseAction(policyInput)).resolves.toMatchObject({
        ...fallbackDecision,
        rationale: expect.stringContaining("LLM fallback after LLM_UNAVAILABLE"),
        observedStateCitations: expect.arrayContaining(["LLM fallback after LLM_UNAVAILABLE"])
      });
    }

    expect(fallbackErrors.map((error) => error.code)).toEqual([
      "LLM_UNAVAILABLE",
      "LLM_UNAVAILABLE",
      "LLM_UNAVAILABLE",
      "LLM_UNAVAILABLE",
      "LLM_UNAVAILABLE"
    ]);
    expect(JSON.stringify(fallbackErrors.map((error) => error.toJSON()))).not.toContain("unit-test-key");
  });

  it("uses fallback without contacting the client after max LLM calls is reached", async () => {
    const requests: ChatCompletionRequest[] = [];
    const fallbackErrors: HarnessError[] = [];
    const policy = createPolicy({
      maxLlmCalls: 1,
      client: fakeClient(async (request) => {
        requests.push(request);
        return JSON.stringify(validDecision);
      }),
      onFallback: (error) => fallbackErrors.push(error)
    });

    await expect(policy.chooseAction(policyInput)).resolves.toEqual(validDecision);
    await expect(policy.chooseAction(policyInput)).resolves.toMatchObject({
      ...fallbackDecision,
      rationale: expect.stringContaining("LLM fallback after BUDGET_EXCEEDED"),
      observedStateCitations: expect.arrayContaining(["LLM fallback after BUDGET_EXCEEDED"])
    });

    expect(requests).toHaveLength(1);
    expect(policy.getCallCount()).toBe(1);
    expect(fallbackErrors.map((error) => error.code)).toEqual(["BUDGET_EXCEEDED"]);
  });
});

function createPolicy(overrides: {
  client: ChatCompletionsClient;
  maxLlmCalls?: number;
  harnessMode?: "stage1" | "full-game";
  visionDetail?: "low" | "high" | "auto";
  onFallback?: (error: HarnessError) => void;
  onConversation?: (conversation: LLMConversationTrace) => void | Promise<void>;
}): LLMPolicy {
  return new LLMPolicy({
    apiKey: "unit-test-key",
    baseURL: "https://example.invalid/v1",
    model: "unit-test-model",
    timeoutMs: 1000,
    maxRetries: 0,
    temperature: 0.1,
    maxLlmCalls: overrides.maxLlmCalls ?? 10,
    harnessMode: overrides.harnessMode,
    visionDetail: overrides.visionDetail,
    fallbackPolicy: createFallbackPolicy(),
    client: overrides.client,
    onFallback: overrides.onFallback,
    onConversation: overrides.onConversation
  });
}

function getUserText(request: ChatCompletionRequest | undefined): string {
  const content = request?.messages[1]?.content;
  if (typeof content === "string") {
    return content;
  }
  const textPart = content?.find((part) => part.type === "text");
  return textPart?.type === "text" ? textPart.text : "";
}

function decodeDataUrl(url: string): { mediaType: string; bytes: Buffer } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (match === null) {
    throw new Error("expected image data URL");
  }

  return { mediaType: match[1] ?? "", bytes: Buffer.from(match[2] ?? "", "base64") };
}

function createFallbackPolicy(): Policy {
  return {
    async chooseAction() {
      return fallbackDecision;
    }
  };
}

function fakeClient(respond: (request: ChatCompletionRequest) => Promise<string>): ChatCompletionsClient {
  return {
    chat: {
      completions: {
        async create(request) {
          return { choices: [{ message: { content: await respond(request) } }] };
        }
      }
    }
  };
}
