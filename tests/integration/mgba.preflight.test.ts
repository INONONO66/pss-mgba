import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/cli/config.js";
import { runMgbaPreflight } from "../../src/mgba/preflight.js";

const integrationEnabled = process.env.RUN_MGBA_INTEGRATION === "1";
const hasBaseUrl = process.env.MGBA_HTTP_BASE_URL !== undefined && process.env.MGBA_HTTP_BASE_URL.length > 0;
const liveIt = integrationEnabled && hasBaseUrl ? it : it.skip;

describe("mGBA preflight integration", () => {
  liveIt("runs only when RUN_MGBA_INTEGRATION=1 and MGBA_HTTP_BASE_URL are set", async () => {
    const report = await runMgbaPreflight({ config: loadConfig(process.env) });

    expect(report.checks.map((check) => check.name)).toEqual([
      "config",
      "current_frame",
      "ram_wCurMap",
      "ram_wYCoord",
      "ram_wXCoord",
      "screenshot",
      "button_tap"
    ]);
    expect(report.ok).toBe(true);
  });
});
