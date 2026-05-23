import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { HarnessError } from "../../src/errors.js";
import { ScreenshotProcessor } from "../../src/vision/ScreenshotProcessor.js";

describe("ScreenshotProcessor", () => {
  it("crops, downscales without enlargement, compresses, and returns metadata only", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vision-processor-"));
    const sourcePath = path.join(root, "source.png");
    const outputDir = path.join(root, "vision");
    await sharp({
      create: {
        width: 200,
        height: 120,
        channels: 3,
        background: { r: 200, g: 10, b: 20 }
      }
    }).png().toFile(sourcePath);

    const processor = new ScreenshotProcessor({
      outputDir,
      cropLeft: 20,
      cropTop: 10,
      cropWidth: 100,
      cropHeight: 80,
      maxWidth: 50,
      maxHeight: 50,
      format: "jpeg",
      quality: 65,
      detail: "low"
    });

    const result = await processor.process({ sourcePath, step: 7, frame: 42 });
    const outputMetadata = await sharp(result.path).metadata();

    await expect(stat(result.path)).resolves.toMatchObject({ isFile: expect.any(Function) });
    expect(result).toMatchObject({
      sourcePath,
      mediaType: "image/jpeg",
      width: 50,
      height: 40,
      step: 7,
      frame: 42,
      crop: { left: 20, top: 10, width: 100, height: 80 },
      detail: "low"
    });
    expect(outputMetadata.width).toBe(50);
    expect(outputMetadata.height).toBe(40);
    expect(result.bytes).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("base64");
    expect(JSON.stringify(result)).not.toContain("data:image");
  });

  it("auto-crops black padding around the inner game image", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vision-auto-crop-"));
    const sourcePath = path.join(root, "source.png");
    await sharp({
      create: {
        width: 220,
        height: 180,
        channels: 3,
        background: { r: 0, g: 0, b: 0 }
      }
    })
      .composite([{ input: await sharp({
        create: {
          width: 160,
          height: 144,
          channels: 3,
          background: { r: 80, g: 160, b: 120 }
        }
      }).png().toBuffer(), left: 30, top: 18 }])
      .png()
      .toFile(sourcePath);

    const processor = new ScreenshotProcessor({
      outputDir: path.join(root, "vision"),
      cropLeft: 0,
      cropTop: 0,
      cropWidth: 0,
      cropHeight: 0,
      maxWidth: 512,
      maxHeight: 384,
      format: "png",
      quality: 70,
      detail: "low"
    });

    const result = await processor.process({ sourcePath, step: 2, frame: 10 });
    const outputMetadata = await sharp(result.path).metadata();

    expect(result).toMatchObject({
      width: 160,
      height: 144,
      crop: { left: 30, top: 18, width: 160, height: 144 }
    });
    expect(outputMetadata.width).toBe(160);
    expect(outputMetadata.height).toBe(144);
  });

  it("extracts the inner Game Boy screen from a Super Game Boy frame", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vision-sgb-crop-"));
    const sourcePath = path.join(root, "source.png");
    await sharp({
      create: {
        width: 256,
        height: 224,
        channels: 3,
        background: { r: 238, g: 198, b: 45 }
      }
    })
      .composite([{ input: await sharp({
        create: {
          width: 160,
          height: 144,
          channels: 3,
          background: { r: 80, g: 160, b: 120 }
        }
      }).png().toBuffer(), left: 48, top: 40 }])
      .png()
      .toFile(sourcePath);

    const processor = new ScreenshotProcessor({
      outputDir: path.join(root, "vision"),
      cropLeft: 0,
      cropTop: 0,
      cropWidth: 0,
      cropHeight: 0,
      maxWidth: 512,
      maxHeight: 384,
      format: "png",
      quality: 70,
      detail: "low"
    });

    const result = await processor.process({ sourcePath, step: 4, frame: 12 });
    const outputMetadata = await sharp(result.path).metadata();

    expect(result).toMatchObject({
      width: 160,
      height: 144,
      crop: { left: 48, top: 40, width: 160, height: 144 }
    });
    expect(outputMetadata.width).toBe(160);
    expect(outputMetadata.height).toBe(144);
  });

  it("uses explicit crop settings instead of automatic black-padding crop", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vision-explicit-over-auto-"));
    const sourcePath = path.join(root, "source.png");
    await sharp({
      create: {
        width: 220,
        height: 180,
        channels: 3,
        background: { r: 0, g: 0, b: 0 }
      }
    })
      .composite([{ input: await sharp({
        create: {
          width: 160,
          height: 144,
          channels: 3,
          background: { r: 80, g: 160, b: 120 }
        }
      }).png().toBuffer(), left: 30, top: 18 }])
      .png()
      .toFile(sourcePath);

    const processor = new ScreenshotProcessor({
      outputDir: path.join(root, "vision"),
      cropLeft: 40,
      cropTop: 28,
      cropWidth: 80,
      cropHeight: 72,
      maxWidth: 512,
      maxHeight: 384,
      format: "png",
      quality: 70,
      detail: "low"
    });

    const result = await processor.process({ sourcePath, step: 3, frame: 11 });

    expect(result).toMatchObject({
      width: 80,
      height: 72,
      crop: { left: 40, top: 28, width: 80, height: 72 }
    });
  });

  it("falls back to the full image when automatic crop is ambiguous", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vision-auto-full-"));
    const sourcePath = path.join(root, "source.png");
    await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 }
      }
    }).png().toFile(sourcePath);

    const processor = new ScreenshotProcessor({
      outputDir: path.join(root, "vision"),
      cropLeft: 0,
      cropTop: 0,
      cropWidth: 0,
      cropHeight: 0,
      maxWidth: 512,
      maxHeight: 384,
      format: "png",
      quality: 70,
      detail: "auto"
    });

    const result = await processor.process({ sourcePath, step: 1, frame: 2 });

    expect(result).toMatchObject({
      mediaType: "image/png",
      width: 40,
      height: 30,
      crop: { left: 0, top: 0, width: 40, height: 30 },
      detail: "auto"
    });
  });

  it("uses the full non-padded image and does not enlarge small screenshots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vision-full-"));
    const sourcePath = path.join(root, "source.png");
    await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 4,
        background: { r: 0, g: 20, b: 200, alpha: 1 }
      }
    }).png().toFile(sourcePath);

    const processor = new ScreenshotProcessor({
      outputDir: path.join(root, "vision"),
      cropLeft: 0,
      cropTop: 0,
      cropWidth: 0,
      cropHeight: 0,
      maxWidth: 512,
      maxHeight: 384,
      format: "png",
      quality: 70,
      detail: "auto"
    });

    const result = await processor.process({ sourcePath, step: 1, frame: 2 });

    expect(result).toMatchObject({
      mediaType: "image/png",
      width: 40,
      height: 30,
      crop: { left: 0, top: 0, width: 40, height: 30 },
      detail: "auto"
    });
  });

  it("rejects crop rectangles outside source bounds", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vision-crop-"));
    const sourcePath = path.join(root, "source.png");
    await sharp({
      create: {
        width: 100,
        height: 80,
        channels: 3,
        background: { r: 20, g: 20, b: 20 }
      }
    }).png().toFile(sourcePath);

    const processor = new ScreenshotProcessor({
      outputDir: path.join(root, "vision"),
      cropLeft: 90,
      cropTop: 0,
      cropWidth: 20,
      cropHeight: 20,
      maxWidth: 50,
      maxHeight: 50,
      format: "webp",
      quality: 70,
      detail: "high"
    });

    await expect(processor.process({ sourcePath, step: 1, frame: 1 })).rejects.toMatchObject({
      code: "SCREENSHOT_FAILED"
    } satisfies Partial<HarnessError>);
  });
});
