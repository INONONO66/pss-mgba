import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { redactSecrets } from "../src/evidence/redaction.js";

describe("loadConfig", () => {
  it("loads OpenAI-compatible Grok defaults when an API key is present", () => {
    const config = loadConfig({ OPENAI_API_KEY: "unit-test-key" });

    expect(config).toMatchObject({
      mgbaHttpBaseUrl: "http://127.0.0.1:5000",
      pokemonVersion: "red",
      evidenceDir: "runs",
      logLevel: "info",
      loopMaxSteps: 999_999,
      loopStepDelayMs: 250,
      defaultTapFrames: 5,
      defaultHoldFrames: 15,
      harnessMode: "full-game",
      aiProvider: "openai",
      openaiBaseUrl: "http://127.0.0.1:3100/v1",
      openaiModel: "grok-4.3",
      openaiTemperature: 0.2,
    });
    expect(config.openaiApiKey).toBe("unit-test-key");
    expect(config.harnessRunId).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("allows non-LLM commands to load config without an API key", () => {
    const config = loadConfig({});

    expect(config.aiProvider).toBe("openai");
    expect(config.openaiApiKey).toBeUndefined();
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
    expect(() => loadConfig({ AI_PROVIDER: "heuristic" })).toThrow(/AI_PROVIDER must be openai/);
    expect(() => loadConfig({ AI_PROVIDER: "other" })).toThrow(/AI_PROVIDER must be openai/);
    expect(() => loadConfig({ HARNESS_MODE: "credits" })).toThrow(/HARNESS_MODE must be one of: stage1, full-game/);
  });

  it("defaults to full-game mode", () => {
    expect(loadConfig({ OPENAI_API_KEY: "unit-test-key" }).harnessMode).toBe("full-game");
  });

  it("allows opt-in stage1 mode", () => {
    expect(loadConfig({ OPENAI_API_KEY: "unit-test-key", HARNESS_MODE: "stage1" }).harnessMode).toBe("stage1");
  });

  it("rejects invalid numeric ranges", () => {
    expect(() => loadConfig({ LOOP_MAX_STEPS: "0" })).toThrow(/LOOP_MAX_STEPS must be at least 1/);
    expect(() => loadConfig({ OPENAI_TEMPERATURE: "3" })).toThrow(/OPENAI_TEMPERATURE must be at most 2/);
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

  it("redacts inline image data URLs from shared redaction output", () => {
    const imageUrl = "data:image/jpeg;base64,AAAABBBBCCCCDDDDEEEE";
    const redacted = redactSecrets({ responseContent: `echo ${imageUrl}` });

    expect(redacted).toContain("data:image/[redacted];base64,[REDACTED]");
    expect(redacted).not.toContain(imageUrl);
    expect(redacted).not.toContain("AAAABBBB");
  });
});
