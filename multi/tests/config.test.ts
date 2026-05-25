import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const ORIGINAL_ENV = { ...process.env };

describe("loadConfig", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to the 10-instance target and rejects larger env overrides", () => {
    delete process.env.MAX_INSTANCES;
    expect(loadConfig().maxInstances).toBe(10);

    process.env.MAX_INSTANCES = "11";
    expect(() => loadConfig()).toThrow();
  });

  it("coerces benchmark-relevant numeric settings", () => {
    process.env.MAX_INSTANCES = "4";
    process.env.CAPTURE_INTERVAL_MS = "16";
    process.env.JPEG_QUALITY = "70";
    process.env.WS_BACKPRESSURE_LIMIT = "1024";

    expect(loadConfig()).toMatchObject({
      captureIntervalMs: 16,
      jpegQuality: 70,
      maxInstances: 4,
      wsBackpressureLimit: 1024,
    });
  });
});
