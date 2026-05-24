import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import type { MgbaHttpClient } from "../src/mgba-http";
import {
  captureMgbaObservation,
  createObservedInput,
} from "../src/observation";
import {
  createObservedContinuationInput,
  createObservedTurnInput,
} from "../src/runner";
import { createRgbaPng, readPngSize } from "./png";

const pngBase64 = "iVBORw0KGgo=";
const stateBytes = new Map([
  [0xd3_5e, 12],
  [0xd3_61, 14],
  [0xd3_62, 10],
  [0xc1_09, 4],
  [0xd0_57, 0],
  [0xd0_5a, 0],
  [0xcf_0b, 0],
]);

function fakeClient({ failAt }: { failAt?: number } = {}): MgbaHttpClient {
  return {
    read8: (address: number) => {
      if (address === failAt) {
        throw new Error("read failed");
      }
      const value = stateBytes.get(address);
      if (value === undefined) {
        throw new Error(`unexpected address ${address}`);
      }
      return Promise.resolve(value);
    },
    screenshot: async (targetPath: string) => {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, Buffer.from(pngBase64, "base64"));
      return "";
    },
    status: async () => ({
      activeButtons: [],
      frame: 2817,
      gameCode: "DMG-AR",
      gameTitle: "PKMN RED ST",
    }),
  } as unknown as MgbaHttpClient;
}

function fakeScreenshotClient(screenshot: Buffer): MgbaHttpClient {
  return {
    read8: (address: number) => {
      const value = stateBytes.get(address);
      if (value === undefined) {
        throw new Error(`unexpected address ${address}`);
      }
      return Promise.resolve(value);
    },
    screenshot: async (targetPath: string) => {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, screenshot);
      return "";
    },
    status: async () => ({
      activeButtons: [],
      frame: 2817,
      gameCode: "DMG-AR",
      gameTitle: "PKMN RED ST",
    }),
  } as unknown as MgbaHttpClient;
}

describe("mGBA observation input", () => {
  it("captures status plus screenshot and creates multipart agent input", async () => {
    const observation = await captureMgbaObservation(fakeClient());

    expect(observation.status).toMatchObject({
      frame: 2817,
      gameCode: "DMG-AR",
      gameTitle: "PKMN RED ST",
    });
    expect(observation.screenshot.data).toBe(pngBase64);
    expect(observation.state).toEqual({
      battle: false,
      battleResult: 0,
      battleType: 0,
      dialogueLike: "visual-fallback",
      direction: "up",
      mapId: 12,
      menuLike: "visual-fallback",
      position: {
        x: 10,
        y: 14,
      },
      readStatus: "available",
    });

    expect(createObservedInput({ observation, text: "continue" })).toEqual([
      {
        text: [
          "continue",
          "",
          "Current mGBA status:",
          "frame: 2817",
          "game: PKMN RED ST DMG-AR",
          "active buttons: none",
          "",
          "Current compact Pokémon state:",
          "readStatus: available",
          "mapId: 12",
          "position: x=10, y=14",
          "direction: up",
          "battle: false",
          "battleType: 0",
          "battleResult: 0",
          "dialogueLike: visual-fallback",
          "menuLike: visual-fallback",
          "",
          "Current screenshot: attached image below. Red grid lines are movement guide lines marking 16x16 Game Boy movement-cell boundaries. Treat the red grid as movement guide lines. First distinguish blocked cells, open walkable cells, and interactable-looking objects. In indoor scenes, solid black areas/borders/void, walls, furniture, and counters are blocked; visible floor tiles are walkable unless occupied. However, if a black/dark tile looks like a doorway, carpet, threshold, stairs, mat, path marker, or other movement-guiding feature, approach or test it once as a possible transition/exit. Then either move through open floor to explore unseen areas or face an object and press A to interact. Avoid repeating recent actions that did not visibly change progress.",
        ].join("\n"),
        type: "text",
      },
      {
        image: `data:image/png;base64,${pngBase64}`,
        mediaType: "image/png",
        type: "image",
      },
    ]);
    expect(
      createObservedInput({ observation, text: "continue" })[0]
    ).not.toEqual(
      expect.objectContaining({
        text: expect.stringContaining(observation.screenshot.path),
      })
    );
  });

  it("marks compact Pokémon state unavailable when any RAM read fails", async () => {
    const observation = await captureMgbaObservation(
      fakeClient({ failAt: 0xd3_61 })
    );
    const input = createObservedInput({ observation, text: "continue" });

    expect(observation.state).toMatchObject({
      mapId: null,
      position: {
        x: null,
        y: null,
      },
      readStatus: "unavailable",
    });
    expect(input[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining("readStatus: unavailable"),
      })
    );
  });

  it("preserves screenshot and status observation when RAM state is unavailable", async () => {
    const observation = await captureMgbaObservation(
      fakeClient({ failAt: 0xd0_5a })
    );
    const input = createObservedInput({ observation, text: "continue" });

    expect(observation.status.frame).toBe(2817);
    expect(observation.screenshot.data).toBe(pngBase64);
    expect(observation.state?.readStatus).toBe("unavailable");
    expect(input).toEqual([
      expect.objectContaining({
        text: expect.stringContaining(
          "Current screenshot: attached image below."
        ),
        type: "text",
      }),
      expect.objectContaining({
        image: `data:image/png;base64,${pngBase64}`,
        mediaType: "image/png",
        type: "image",
      }),
    ]);
  });

  it("center-crops a 240x160 GBA screenshot to exact 160x144 GB model input", async () => {
    const observation = await captureMgbaObservation(
      fakeScreenshotClient(createRgbaPng({ width: 240, height: 160 }))
    );
    const input = createObservedInput({ observation, text: "continue" });
    const image = input.find((part) => part.type === "image");

    expect(readPngSize(observation.screenshot.data)).toEqual({
      width: 160,
      height: 144,
    });
    expect(image).toEqual(
      expect.objectContaining({
        image: `data:image/png;base64,${observation.screenshot.data}`,
        mediaType: "image/png",
        type: "image",
      })
    );
  });

  it("center-crops an actual 256x224 mGBA GB screenshot to exact 160x144 model input", async () => {
    const observation = await captureMgbaObservation(
      fakeScreenshotClient(createRgbaPng({ width: 256, height: 224 }))
    );
    const input = createObservedInput({ observation, text: "continue" });
    const image = input.find((part) => part.type === "image");

    expect(readPngSize(observation.screenshot.data)).toEqual({
      width: 160,
      height: 144,
    });
    expect(image).toEqual(
      expect.objectContaining({
        image: `data:image/png;base64,${observation.screenshot.data}`,
        mediaType: "image/png",
        type: "image",
      })
    );
  });

  it("preserves non-target screenshots instead of blindly cropping", async () => {
    const observation = await captureMgbaObservation(
      fakeScreenshotClient(createRgbaPng({ width: 80, height: 72 }))
    );

    expect(readPngSize(observation.screenshot.data)).toEqual({
      width: 80,
      height: 72,
    });
  });

  it("injects compact failed movement memory and bounds failed edge history", () => {
    const input = createObservedInput({
      observation: {
        screenshot: {
          data: pngBase64,
          mediaType: "image/png",
          path: "/tmp/screen.png",
        },
        state: {
          battle: false,
          battleResult: 0,
          battleType: 0,
          dialogueLike: "visual-fallback",
          direction: "up",
          mapId: 12,
          menuLike: "visual-fallback",
          position: {
            x: 10,
            y: 14,
          },
          readStatus: "available",
        },
        status: {
          activeButtons: [],
          frame: 2817,
          gameCode: "DMG-AR",
          gameTitle: "PKMN RED ST",
        },
      },
      stuckMemory: {
        failedMovementEdges: Array.from({ length: 8 }, (_, index) => ({
          action: `hold:Direction${index}`,
          attempts: index + 1,
          context: `map=12 x=${index} y=14 facing=up`,
          lastSeenTurn: index + 20,
        })),
        recentRecoveryAttempts: [
          {
            action: 'tap: {"button":"A"}',
            context: "map=12 x=7 y=14 facing=up",
            turn: 30,
          },
        ],
        stuckEvents: 1,
      },
      text: "continue",
    });

    expect(input[0]).toEqual({
      text: [
        "continue",
        "",
        "Current mGBA status:",
        "frame: 2817",
        "game: PKMN RED ST DMG-AR",
        "active buttons: none",
        "",
        "Current compact Pokémon state:",
        "readStatus: available",
        "mapId: 12",
        "position: x=10, y=14",
        "direction: up",
        "battle: false",
        "battleType: 0",
        "battleResult: 0",
        "dialogueLike: visual-fallback",
        "menuLike: visual-fallback",
        "failed movement memory:",
        "- map=12 x=2 y=14 facing=up; hold:Direction2; failed 3x; last turn 22",
        "- map=12 x=3 y=14 facing=up; hold:Direction3; failed 4x; last turn 23",
        "- map=12 x=4 y=14 facing=up; hold:Direction4; failed 5x; last turn 24",
        "- map=12 x=5 y=14 facing=up; hold:Direction5; failed 6x; last turn 25",
        "- map=12 x=6 y=14 facing=up; hold:Direction6; failed 7x; last turn 26",
        "- map=12 x=7 y=14 facing=up; hold:Direction7; failed 8x; last turn 27",
        "recent recovery attempts:",
        '- turn 30: tap: {"button":"A"} after map=12 x=7 y=14 facing=up',
        "",
        "Current screenshot: attached image below. Red grid lines are movement guide lines marking 16x16 Game Boy movement-cell boundaries. Treat the red grid as movement guide lines. First distinguish blocked cells, open walkable cells, and interactable-looking objects. In indoor scenes, solid black areas/borders/void, walls, furniture, and counters are blocked; visible floor tiles are walkable unless occupied. However, if a black/dark tile looks like a doorway, carpet, threshold, stairs, mat, path marker, or other movement-guiding feature, approach or test it once as a possible transition/exit. Then either move through open floor to explore unseen areas or face an object and press A to interact. Avoid repeating recent actions that did not visibly change progress.",
      ].join("\n"),
      type: "text",
    });
    expect(input[0]).not.toEqual(
      expect.objectContaining({
        text: expect.stringContaining("hold:Direction0"),
      })
    );
  });

  it("builds observed input for the first autonomous send", async () => {
    let observedFrame: number | null | undefined;
    const input = await createObservedTurnInput({
      client: fakeClient(),
      onObservation: (observation) => {
        observedFrame = observation.status.frame;
      },
      turn: 1,
    });

    expect(observedFrame).toBe(2817);
    expect(input).toEqual([
      {
        text: expect.stringContaining("already-loaded Pokémon game"),
        type: "text",
      },
      expect.objectContaining({
        image: `data:image/png;base64,${pngBase64}`,
        mediaType: "image/png",
        type: "image",
      }),
    ]);
  });

  it("awaits async observation hooks before returning observed input", async () => {
    const order: string[] = [];
    const input = await createObservedTurnInput({
      client: fakeClient(),
      onObservation: async () => {
        order.push("hook-start");
        await Promise.resolve();
        order.push("hook-end");
      },
      turn: 1,
    });

    order.push("after-input");
    expect(order).toEqual(["hook-start", "hook-end", "after-input"]);
    expect(input[1]).toEqual(
      expect.objectContaining({
        image: `data:image/png;base64,${pngBase64}`,
        type: "image",
      })
    );
  });

  it("builds observed continuation input for the next autonomous turn", async () => {
    let observedFrame: number | null | undefined;
    const input = await createObservedContinuationInput({
      client: fakeClient(),
      onObservation: (observation) => {
        observedFrame = observation.status.frame;
      },
      turn: 7,
    });

    expect(observedFrame).toBe(2817);
    expect(input).toEqual([
      {
        text: expect.stringContaining("Turn 7 ended"),
        type: "text",
      },
      expect.objectContaining({
        image: `data:image/png;base64,${pngBase64}`,
        mediaType: "image/png",
        type: "image",
      }),
    ]);
  });
});
