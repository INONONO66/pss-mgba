import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { redactSecrets } from "../src/evidence/redaction.js";

describe("loadConfig", () => {
  it("loads heuristic defaults without requiring an OpenAI key", () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      mgbaHttpBaseUrl: "http://127.0.0.1:5000",
      pokemonVersion: "red",
      evidenceDir: "runs",
      logLevel: "info",
      loopMaxSteps: undefined,
      loopStepDelayMs: 250,
      maxLlmCalls: undefined,
      llmTimeoutMs: 20000,
      llmMaxRetries: 1,
      defaultTapFrames: 5,
      defaultHoldFrames: 15,
      harnessMode: "stage1",
      aiProvider: "heuristic",
      openaiBaseUrl: "https://api.openai.com/v1",
      openaiModel: "gpt-5.5",
      openaiTemperature: 0.2,
      llmVisionEnabled: false,
      llmVisionMaxImages: 3,
      llmVisionCropLeft: 0,
      llmVisionCropTop: 0,
      llmVisionCropWidth: 0,
      llmVisionCropHeight: 0,
      llmVisionMaxWidth: 512,
      llmVisionMaxHeight: 384,
      llmVisionFormat: "jpeg",
      llmVisionQuality: 70,
      llmVisionDetail: "low"
    });
    expect(config.openaiApiKey).toBeUndefined();
    expect(config.harnessRunId).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("requires provider-specific API keys only when an LLM provider is selected", () => {
    expect(() => loadConfig({ AI_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY is required when AI_PROVIDER=openai/);

    expect(loadConfig({ AI_PROVIDER: "heuristic" }).openaiApiKey).toBeUndefined();
  });

  it("preserves OpenAI provider settings when an OpenAI key is present", () => {
    const config = loadConfig({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "openai-unit-test-key",
      OPENAI_BASE_URL: "https://openai.example.invalid/v1",
      OPENAI_MODEL: "openai-model"
    });

    expect(config.aiProvider).toBe("openai");
    expect(config.openaiApiKey).toBe("openai-unit-test-key");
    expect(config.openaiBaseUrl).toBe("https://openai.example.invalid/v1");
    expect(config.openaiModel).toBe("openai-model");
  });

  it("rejects invalid URLs with actionable messages", () => {
    expect(() => loadConfig({ MGBA_HTTP_BASE_URL: "not a url" })).toThrow(/MGBA_HTTP_BASE_URL must be a valid URL/);
    expect(() => loadConfig({ OPENAI_BASE_URL: "not a url" })).toThrow(/OPENAI_BASE_URL must be a valid URL/);
  });

  it("rejects unsupported Pokemon versions and provider values", () => {
    expect(() => loadConfig({ POKEMON_VERSION: "yellow" })).toThrow(/POKEMON_VERSION must be one of: red, blue/);
    expect(() => loadConfig({ AI_PROVIDER: "other" })).toThrow(/AI_PROVIDER must be one of: heuristic, openai/);
    expect(() => loadConfig({ HARNESS_MODE: "credits" })).toThrow(/HARNESS_MODE must be one of: stage1, full-game/);
  });

  it("loads opt-in full-game mode", () => {
    expect(loadConfig({ HARNESS_MODE: "full-game" }).harnessMode).toBe("full-game");
  });

  it("rejects invalid numeric ranges", () => {
    expect(() => loadConfig({ LOOP_MAX_STEPS: "0" })).toThrow(/LOOP_MAX_STEPS must be at least 1/);
    expect(() => loadConfig({ LLM_TIMEOUT_MS: "0" })).toThrow(/LLM_TIMEOUT_MS must be at least 1/);
    expect(() => loadConfig({ OPENAI_TEMPERATURE: "3" })).toThrow(/OPENAI_TEMPERATURE must be at most 2/);
    expect(() => loadConfig({ LLM_VISION_MAX_IMAGES: "0" })).toThrow(/LLM_VISION_MAX_IMAGES must be at least 1/);
    expect(() => loadConfig({ LLM_VISION_MAX_WIDTH: "0" })).toThrow(/LLM_VISION_MAX_WIDTH must be at least 1/);
    expect(() => loadConfig({ LLM_VISION_QUALITY: "101" })).toThrow(/LLM_VISION_QUALITY must be at most 100/);
  });

  it("loads and validates optional budget settings", () => {
    expect(loadConfig({ LOOP_MAX_STEPS: "12", MAX_LLM_CALLS: "34" })).toMatchObject({
      loopMaxSteps: 12,
      maxLlmCalls: 34
    });

    expect(loadConfig({ LOOP_MAX_STEPS: "", MAX_LLM_CALLS: "" })).toMatchObject({
      loopMaxSteps: undefined,
      maxLlmCalls: undefined
    });
    expect(loadConfig({ MAX_LLM_CALLS: "0" }).maxLlmCalls).toBe(0);
    expect(() => loadConfig({ LOOP_MAX_STEPS: "-1" })).toThrow(/LOOP_MAX_STEPS must be at least 1/);
    expect(() => loadConfig({ MAX_LLM_CALLS: "-1" })).toThrow(/MAX_LLM_CALLS must be at least 0/);
    expect(() => loadConfig({ LOOP_MAX_STEPS: "abc" })).toThrow(/LOOP_MAX_STEPS must be a number/);
    expect(() => loadConfig({ MAX_LLM_CALLS: "abc" })).toThrow(/MAX_LLM_CALLS must be a number/);
  });

  it("loads and validates optional LLM vision settings", () => {
    const config = loadConfig({
      LLM_VISION_ENABLED: "yes",
      LLM_VISION_MAX_IMAGES: "5",
      LLM_VISION_CROP_LEFT: "10",
      LLM_VISION_CROP_TOP: "12",
      LLM_VISION_CROP_WIDTH: "120",
      LLM_VISION_CROP_HEIGHT: "80",
      LLM_VISION_MAX_WIDTH: "320",
      LLM_VISION_MAX_HEIGHT: "240",
      LLM_VISION_FORMAT: "webp",
      LLM_VISION_QUALITY: "60",
      LLM_VISION_DETAIL: "auto"
    });

    expect(config).toMatchObject({
      llmVisionEnabled: true,
      llmVisionMaxImages: 5,
      llmVisionCropLeft: 10,
      llmVisionCropTop: 12,
      llmVisionCropWidth: 120,
      llmVisionCropHeight: 80,
      llmVisionMaxWidth: 320,
      llmVisionMaxHeight: 240,
      llmVisionFormat: "webp",
      llmVisionQuality: 60,
      llmVisionDetail: "auto"
    });

    expect(() => loadConfig({ LLM_VISION_FORMAT: "gif" })).toThrow(/LLM_VISION_FORMAT must be one of: jpeg, webp, png/);
    expect(() => loadConfig({ LLM_VISION_DETAIL: "medium" })).toThrow(/LLM_VISION_DETAIL must be one of: low, high, auto/);
    expect(() => loadConfig({ LLM_VISION_ENABLED: "maybe" })).toThrow(/LLM_VISION_ENABLED must be a boolean/);
    expect(() => loadConfig({ LLM_VISION_CROP_WIDTH: "10" })).toThrow(/LLM_VISION_CROP_WIDTH and LLM_VISION_CROP_HEIGHT must both be positive/);
  });
});

describe("redactSecrets", () => {
  it("redacts OpenAI API key fields and OpenAI-style token values", () => {
    const secretLikeValue = `s${"k"}-exampleSecret_123`;
    const redacted = redactSecrets({
      OPENAI_API_KEY: "example-secret-value",
      nested: `prefix ${secretLikeValue} suffix`
    });

    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain("example-secret-value");
    expect(redacted).not.toContain(secretLikeValue);
  });
});
