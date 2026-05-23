import { describe, expect, it } from "vitest";
import { MgbaHttpClient } from "../src/mgba-http";
import { createMgbaControlPlane } from "../src/tools";

describe("createMgbaControlPlane", () => {
  it("registers screenshot observation with the mGBA tools", () => {
    const tools = createMgbaControlPlane({
      client: new MgbaHttpClient({ baseUrl: "http://127.0.0.1:5000" }),
      romPath: "/tmp/game.gb",
    });

    expect(Object.keys(tools).sort()).toEqual([
      "mgba_hold",
      "mgba_hold_many",
      "mgba_load_rom",
      "mgba_release",
      "mgba_reset",
      "mgba_screenshot",
      "mgba_status",
      "mgba_tap",
      "mgba_tap_many",
    ]);
  });

  it("can hide observation tools when observations are injected by the runner", () => {
    const tools = createMgbaControlPlane({
      client: new MgbaHttpClient({ baseUrl: "http://127.0.0.1:5000" }),
      includeObservationTools: false,
      romPath: "/tmp/game.gb",
    });

    expect(Object.keys(tools).sort()).toEqual([
      "mgba_hold",
      "mgba_hold_many",
      "mgba_load_rom",
      "mgba_release",
      "mgba_reset",
      "mgba_tap",
      "mgba_tap_many",
    ]);
  });
});
