import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import type { MgbaHttpClient } from "../src/mgba-http";
import {
  captureMgbaObservation,
  createObservedInput,
} from "../src/observation";
import { createObservedContinuationInput } from "../src/runner";

const pngBase64 = "iVBORw0KGgo=";

function fakeClient(): MgbaHttpClient {
  return {
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

describe("mGBA observation input", () => {
  it("captures status plus screenshot and creates multipart agent input", async () => {
    const observation = await captureMgbaObservation(fakeClient());

    expect(observation.status).toMatchObject({
      frame: 2817,
      gameCode: "DMG-AR",
      gameTitle: "PKMN RED ST",
    });
    expect(observation.screenshot.data).toBe(pngBase64);

    expect(createObservedInput({ observation, text: "continue" })).toEqual([
      {
        text: expect.stringContaining("Current mGBA status:\nframe: 2817"),
        type: "text",
      },
      {
        image: `data:image/png;base64,${pngBase64}`,
        mediaType: "image/png",
        type: "image",
      },
    ]);
  });

  it("builds observed continuation input for the next autonomous turn", async () => {
    const input = await createObservedContinuationInput({
      client: fakeClient(),
      turn: 7,
    });

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
