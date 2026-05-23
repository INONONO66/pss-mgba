import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { PolicyDecision } from "../../src/control/ActionTypes.js";
import { LLMPolicy, type ChatCompletionRequest, type ChatCompletionsClient, type OpenAIClientOptions } from "../../src/ai/LLMPolicy.js";
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
    expect(prompt).toContain("Current RAM-derived state JSON");
    expect(prompt).toContain("Stage 1 objective");
    expect(prompt).toContain("Stage 1 route facts");
    expect(prompt).toContain("Anti-hardcoding rule");
    expect(prompt).toContain("Output only one JSON object");
    expect(prompt).toContain("Allowed action schema");
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
    expect(content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Current RAM-derived state JSON") });
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

  it("includes compact state-conditioned Stage 1 route facts without a global input timeline", async () => {
    const requests: ChatCompletionRequest[] = [];
    const client = fakeClient(async (request) => {
      requests.push(request);
      return JSON.stringify(validDecision);
    });
    const policy = createPolicy({ client });

    await expect(policy.chooseAction(policyInput)).resolves.toEqual(validDecision);

    const prompt = getUserText(requests[0]);
    expect(prompt).toContain("Stage 1 route facts");
    expect(prompt).toContain("wCurMap/wYCoord/wXCoord/screenTextKind/wPartyCount/wIsInBattle/playerFacingDirection/recentActions");
    expect(prompt).toContain("not as a step-numbered global timeline");
    expect(prompt).toContain("wCurMap=38");
    expect(prompt).toContain("wCurMap=37");
    expect(prompt).toContain("wCurMap=40");
    expect(prompt).toContain("wYCoord=1,wXCoord=10");
    expect(prompt).toContain("wYCoord=3,wXCoord=5");
    expect(prompt).toContain("wYCoord=6");
    expect(prompt).toContain("wIsInBattle is nonzero and screenText shows the main battle menu FIGHT ITEM RUN");
    expect(prompt).toContain("SCRATCH GROWL");
    expect(prompt).toContain("TYPE NORMAL");
    expect(prompt).toContain("pressing A directly");
    expect(prompt).toContain("do not send Up/Down before A");
    expect(prompt).toContain("cursor movement can choose GROWL");
    expect(prompt).toContain("SCRATCH is the damaging move to prefer");
    expect(prompt).toContain("GROWL does not reduce enemy HP");
    expect(prompt).toContain("Battle text such as used SCRATCH");
    expect(prompt).toContain("stale/repeated text");
    expect(prompt).toContain("do not follow or emit a precomputed global input timeline");
    expect(prompt).not.toContain("step 1");
    expect(prompt).not.toContain("step 2");
    expect(prompt).not.toContain("step 3");
    expect(prompt.indexOf("Stage 1 route facts")).toBeLessThan(prompt.indexOf("Allowed action schema"));
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
    expect(prompt).toContain("Full-game objective");
    expect(prompt).toContain("Hall of Fame (map id 0x76)");
    expect(prompt).toContain("Badges are read-only progress signals only");
    expect(prompt).toContain("Do not request or imply memory writes");
    expect(prompt).toContain("precomputed global input timelines");
    expect(prompt).toContain("Do not claim route facts alone, Rival battle exit, or all badges as full-game completion");
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

  it("treats omitted max LLM calls as unlimited", async () => {
    const requests: ChatCompletionRequest[] = [];
    const fallbackErrors: HarnessError[] = [];
    const policy = createPolicy({
      maxLlmCalls: undefined,
      client: fakeClient(async (request) => {
        requests.push(request);
        return JSON.stringify(validDecision);
      }),
      onFallback: (error) => fallbackErrors.push(error)
    });

    await expect(policy.chooseAction(policyInput)).resolves.toEqual(validDecision);
    await expect(policy.chooseAction(policyInput)).resolves.toEqual(validDecision);
    await expect(policy.chooseAction(policyInput)).resolves.toEqual(validDecision);

    expect(requests).toHaveLength(3);
    expect(policy.getCallCount()).toBe(3);
    expect(fallbackErrors).toHaveLength(0);
  });
});

function createPolicy(overrides: {
  client: ChatCompletionsClient;
  maxLlmCalls?: number;
  harnessMode?: "stage1" | "full-game";
  visionDetail?: "low" | "high" | "auto";
  onFallback?: (error: HarnessError) => void;
}): LLMPolicy {
  return new LLMPolicy({
    apiKey: "unit-test-key",
    baseURL: "https://example.invalid/v1",
    model: "unit-test-model",
    timeoutMs: 1000,
    maxRetries: 0,
    temperature: 0.1,
    maxLlmCalls: overrides.maxLlmCalls,
    harnessMode: overrides.harnessMode,
    visionDetail: overrides.visionDetail,
    fallbackPolicy: createFallbackPolicy(),
    client: overrides.client,
    onFallback: overrides.onFallback
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
