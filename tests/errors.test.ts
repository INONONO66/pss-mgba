import { describe, expect, it } from "vitest";
import { HarnessError } from "../src/shared/errors.js";

describe("HarnessError", () => {
  const fakeSecretPrefix = `s${"k"}-test`;

  it("serializes code, message, and safe context", () => {
    const error = new HarnessError("MGBA_UNAVAILABLE", "mGBA unavailable", {
      context: {
        endpoint: "/core/currentFrame",
        status: 503
      }
    });

    expect(error.toJSON()).toEqual({
      name: "HarnessError",
      code: "MGBA_UNAVAILABLE",
      message: "mGBA unavailable",
      context: {
        endpoint: "/core/currentFrame",
        status: 503
      }
    });
  });

  it("redacts secret-like values from serialized context and cause", () => {
    const error = new HarnessError("LLM_UNAVAILABLE", `provider failed for ${fakeSecretPrefix}-message`, {
      cause: new Error(`upstream rejected token=${fakeSecretPrefix}-cause`),
      context: {
        apiKey: `${fakeSecretPrefix}-context`,
        nested: {
          header: `Authorization: Bearer ${fakeSecretPrefix}-header`,
          values: ["safe", `${fakeSecretPrefix}-array`]
        }
      }
    });

    const serialized = error.toJSON();
    const serializedText = JSON.stringify(serialized);

    expect(serialized.message).toBe("provider failed for [REDACTED]");
    expect(serialized.context).toMatchObject({
      apiKey: "[REDACTED]",
      nested: {
        header: "[REDACTED]",
        values: ["safe", "[REDACTED]"]
      }
    });
    expect(serialized.cause).toBe("upstream rejected [REDACTED]");
    expect(serializedText).not.toContain(fakeSecretPrefix);
  });
});
