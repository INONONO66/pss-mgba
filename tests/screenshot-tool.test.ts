import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import type { MgbaHttpClient } from "../src/mgba-http";
import { createScreenshotTool } from "../src/tools/screenshot";
import { createRgbaPng, readPngSize } from "./png";

const pngBase64 = "iVBORw0KGgo=";

describe("createScreenshotTool", () => {
  it("captures a PNG and exposes it as model-visible image content", async () => {
    let capturedPath = "";
    const client = {
      screenshot: async (targetPath: string) => {
        capturedPath = targetPath;
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, Buffer.from(pngBase64, "base64"));
        return "";
      },
    } as MgbaHttpClient;
    const tool = createScreenshotTool({ client, romPath: "/tmp/game.gb" });

    const output = await tool.execute?.(
      {},
      {
        abortSignal: undefined,
        context: undefined,
        messages: [],
        toolCallId: "call-test",
      }
    );

    expect(capturedPath.startsWith(`${tmpdir()}/pss-mgba-screenshots/`)).toBe(
      true
    );
    expect(output).toEqual({
      data: pngBase64,
      mediaType: "image/png",
      path: capturedPath,
    });

    const modelOutput = await tool.toModelOutput?.({
      input: {},
      output,
      toolCallId: "call-test",
    });

    expect(modelOutput).toEqual({
      type: "content",
      value: [
        {
          type: "text",
          text: `Current mGBA screenshot saved at ${capturedPath}.`,
        },
        {
          type: "file",
          mediaType: "image/png",
          data: { type: "data", data: pngBase64 },
          filename: "mgba-screenshot.png",
        },
      ],
    });
  });

  it("exposes 240x160 screenshots to the model as exact 160x144 GB crops", async () => {
    const client = {
      screenshot: async (targetPath: string) => {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, createRgbaPng({ width: 240, height: 160 }));
        return "";
      },
    } as MgbaHttpClient;
    const tool = createScreenshotTool({ client, romPath: "/tmp/game.gb" });

    const output = await tool.execute?.(
      {},
      {
        abortSignal: undefined,
        context: undefined,
        messages: [],
        toolCallId: "call-test",
      }
    );
    const modelOutput = await tool.toModelOutput?.({
      input: {},
      output,
      toolCallId: "call-test",
    });

    expect(readPngSize((output as { data: string }).data)).toEqual({
      width: 160,
      height: 144,
    });
    expect(modelOutput).toEqual(
      expect.objectContaining({
        value: expect.arrayContaining([
          expect.objectContaining({
            data: { type: "data", data: (output as { data: string }).data },
            mediaType: "image/png",
            type: "file",
          }),
        ]),
      })
    );
  });

  it("exposes actual 256x224 mGBA GB screenshots as exact 160x144 GB crops", async () => {
    const client = {
      screenshot: async (targetPath: string) => {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, createRgbaPng({ width: 256, height: 224 }));
        return "";
      },
    } as MgbaHttpClient;
    const tool = createScreenshotTool({ client, romPath: "/tmp/game.gb" });

    const output = await tool.execute?.(
      {},
      {
        abortSignal: undefined,
        context: undefined,
        messages: [],
        toolCallId: "call-test",
      }
    );

    expect(readPngSize((output as { data: string }).data)).toEqual({
      width: 160,
      height: 144,
    });
  });

  it("uses unique internal paths for concurrent screenshots", async () => {
    const paths: string[] = [];
    const client = {
      screenshot: async (targetPath: string) => {
        paths.push(targetPath);
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, Buffer.from(pngBase64, "base64"));
        return "";
      },
    } as MgbaHttpClient;
    const tool = createScreenshotTool({ client, romPath: "/tmp/game.gb" });
    const options = {
      abortSignal: undefined,
      context: undefined,
      messages: [],
      toolCallId: "call-test",
    };

    await Promise.all([
      tool.execute?.({}, options),
      tool.execute?.({}, options),
      tool.execute?.({}, options),
    ]);

    expect(new Set(paths).size).toBe(3);
  });
});
