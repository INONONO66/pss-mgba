import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/cli/config.js";
import { HarnessError } from "../../src/shared/errors.js";
import { type MgbaPreflightClient, runMgbaPreflight } from "../../src/mgba/preflight.js";
import { wCurMap, wXCoord, wYCoord } from "../../src/game/memoryMap.js";

interface FakeClient extends MgbaPreflightClient {
  readonly calls: string[];
}

describe("runMgbaPreflight", () => {
  it("runs every safe check in order and reports warning-only missing ROM config", async () => {
    const client = createFakeClient();
    const config = loadConfig({
      OPENAI_API_KEY: "unit-test-key",
      MGBA_HTTP_BASE_URL: "http://127.0.0.1:5000",
      DEFAULT_TAP_FRAMES: "7"
    });

    const report = await runMgbaPreflight({ config, client });

    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => [check.name, check.status])).toEqual([
      ["config", "warn"],
      ["current_frame", "pass"],
      ["ram_wCurMap", "pass"],
      ["ram_wYCoord", "pass"],
      ["ram_wXCoord", "pass"],
      ["screenshot", "pass"],
      ["button_tap", "pass"]
    ]);
    expect(client.calls).toEqual([
      "currentFrame",
      `read8:${wCurMap}`,
      `read8:${wYCoord}`,
      `read8:${wXCoord}`,
      "screenshot",
      "tapButton:B:7"
    ]);
    expect(report.checks[0]).toMatchObject({
      errorCode: "ROM_NOT_LOADED_OR_INVALID",
      guidance: expect.stringContaining("POKEMON_ROM_PATH")
    });
  });

  it("reports pass for configured ROM path without opening or loading it", async () => {
    const client = createFakeClient();
    const config = loadConfig({
      OPENAI_API_KEY: "unit-test-key",
      MGBA_HTTP_BASE_URL: "http://127.0.0.1:5000",
      POKEMON_ROM_PATH: "/roms/pokemon-red.gb"
    });

    const report = await runMgbaPreflight({ config, client });

    expect(report.checks[0]).toMatchObject({
      name: "config",
      status: "pass",
      details: expect.objectContaining({ hasPokemonRomPath: true })
    });
  });

  it("continues after failures and includes setup guidance per failed check", async () => {
    const client = createFakeClient({
      currentFrame: () => {
        throw new HarnessError("MGBA_UNAVAILABLE", "mGBA-http request could not be completed", {
          context: { endpoint: "/core/currentframe" }
        });
      },
      screenshot: () => {
        throw new HarnessError("SCREENSHOT_FAILED", "mGBA-http request failed", {
          context: { endpoint: "/core/screenshot", status: 500 }
        });
      },
      tapButton: () => {
        throw new HarnessError("MGBA_UNAVAILABLE", "mGBA-http request failed", {
          context: { endpoint: "/mgba-http/button/tap", status: 404 }
        });
      }
    });
    const config = loadConfig({ OPENAI_API_KEY: "unit-test-key", MGBA_HTTP_BASE_URL: "http://127.0.0.1:5000" });

    const report = await runMgbaPreflight({ config, client });

    expect(report.ok).toBe(false);
    expect(report.checks.map((check) => check.name)).toEqual([
      "config",
      "current_frame",
      "ram_wCurMap",
      "ram_wYCoord",
      "ram_wXCoord",
      "screenshot",
      "button_tap"
    ]);
    expect(report.checks.find((check) => check.name === "current_frame")).toMatchObject({
      status: "fail",
      errorCode: "MGBA_UNAVAILABLE",
      guidance: expect.stringContaining("MGBA_HTTP_BASE_URL")
    });
    expect(report.checks.find((check) => check.name === "screenshot")).toMatchObject({
      status: "fail",
      errorCode: "SCREENSHOT_FAILED",
      guidance: expect.stringContaining("screenshot")
    });
    expect(report.checks.find((check) => check.name === "button_tap")).toMatchObject({
      status: "fail",
      details: { endpoint: "/mgba-http/button/tap", status: 404 },
      guidance: expect.stringContaining("mGBASocketServer.lua")
    });
  });
});

function createFakeClient(overrides: Partial<MgbaPreflightClient> = {}): FakeClient {
  const calls: string[] = [];

  return {
    calls,
    currentFrame() {
      calls.push("currentFrame");
      if (overrides.currentFrame !== undefined) {
        return overrides.currentFrame();
      }
      return Promise.resolve(123);
    },
    read8(address: number) {
      calls.push(`read8:${address}`);
      if (overrides.read8 !== undefined) {
        return overrides.read8(address);
      }
      return Promise.resolve(address % 256);
    },
    screenshot(path?: string) {
      calls.push("screenshot");
      if (overrides.screenshot !== undefined) {
        return overrides.screenshot(path);
      }
      return Promise.resolve("/tmp/preflight.png");
    },
    tapButton(button: "B", frames: number) {
      calls.push(`tapButton:${button}:${frames}`);
      if (overrides.tapButton !== undefined) {
        return overrides.tapButton(button, frames);
      }
      return Promise.resolve();
    }
  };
}
