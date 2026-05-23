import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { LlmVisionDetail, LlmVisionFormat } from "../config.js";
import { HarnessError } from "../errors.js";
import type { VisionImageInput } from "../ai/Policy.js";

export interface ScreenshotProcessorOptions {
  readonly outputDir: string;
  readonly cropLeft: number;
  readonly cropTop: number;
  readonly cropWidth: number;
  readonly cropHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly format: LlmVisionFormat;
  readonly quality: number;
  readonly detail: LlmVisionDetail;
}

export interface ScreenshotProcessInput {
  readonly sourcePath: string;
  readonly step: number;
  readonly frame: number;
}

interface RawImageBuffer {
  readonly data: Buffer;
  readonly info: sharp.OutputInfo;
}

const AUTO_CROP_BLACK_THRESHOLD = 12;
const AUTO_CROP_MIN_CONTENT_DENSITY = 0.01;
const AUTO_CROP_MIN_SIZE = 32;
const SUPER_GAME_BOY_FRAME = {
  sourceWidth: 256,
  sourceHeight: 224,
  crop: { left: 48, top: 40, width: 160, height: 144 }
};

export class ScreenshotProcessor {
  private readonly options: ScreenshotProcessorOptions;

  constructor(options: ScreenshotProcessorOptions) {
    this.options = options;
  }

  async process(input: ScreenshotProcessInput): Promise<VisionImageInput> {
    await mkdir(this.options.outputDir, { recursive: true });

    const source = sharp(input.sourcePath, { failOn: "error" });
    const metadata = await source.metadata();
    const sourceWidth = metadata.width;
    const sourceHeight = metadata.height;
    if (sourceWidth === undefined || sourceHeight === undefined) {
      throw new HarnessError("SCREENSHOT_FAILED", "Screenshot dimensions could not be read", {
        context: { sourcePath: input.sourcePath }
      });
    }

    const crop = await buildCrop(this.options, source, sourceWidth, sourceHeight);
    const outputPath = path.join(this.options.outputDir, `${formatSequence(input.step)}-frame-${input.frame}.${this.options.format}`);
    let pipeline = source.clone();

    if (crop !== undefined) {
      pipeline = pipeline.extract(crop);
    }

    pipeline = pipeline.resize({
      width: this.options.maxWidth,
      height: this.options.maxHeight,
      fit: "inside",
      withoutEnlargement: true
    });

    const info = await encode(pipeline, this.options.format, this.options.quality).toFile(outputPath);
    const fileStat = await stat(outputPath);

    return {
      path: outputPath,
      sourcePath: input.sourcePath,
      mediaType: mediaTypeForFormat(this.options.format),
      width: info.width,
      height: info.height,
      step: input.step,
      frame: input.frame,
      crop: crop ?? { left: 0, top: 0, width: sourceWidth, height: sourceHeight },
      bytes: fileStat.size,
      detail: this.options.detail
    };
  }
}

async function buildCrop(options: ScreenshotProcessorOptions, source: sharp.Sharp, sourceWidth: number, sourceHeight: number): Promise<VisionImageInput["crop"] | undefined> {
  if (options.cropWidth === 0 && options.cropHeight === 0) {
    if (sourceWidth === SUPER_GAME_BOY_FRAME.sourceWidth && sourceHeight === SUPER_GAME_BOY_FRAME.sourceHeight) {
      return SUPER_GAME_BOY_FRAME.crop;
    }

    return detectContentCrop(source, sourceWidth, sourceHeight);
  }

  const crop = {
    left: options.cropLeft,
    top: options.cropTop,
    width: options.cropWidth,
    height: options.cropHeight
  };

  if (crop.width <= 0 || crop.height <= 0 || crop.left + crop.width > sourceWidth || crop.top + crop.height > sourceHeight) {
    throw new HarnessError("SCREENSHOT_FAILED", "LLM vision crop rectangle is outside the screenshot bounds", {
      context: { crop, sourceWidth, sourceHeight }
    });
  }

  return crop;
}

async function detectContentCrop(source: sharp.Sharp, sourceWidth: number, sourceHeight: number): Promise<VisionImageInput["crop"] | undefined> {
  const { data, info } = await source.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true }) as RawImageBuffer;
  const channels = info.channels;
  const rowContentThreshold = Math.max(1, Math.ceil(sourceWidth * AUTO_CROP_MIN_CONTENT_DENSITY));
  const columnContentThreshold = Math.max(1, Math.ceil(sourceHeight * AUTO_CROP_MIN_CONTENT_DENSITY));

  let top = 0;
  while (top < sourceHeight && countNonBackgroundInRow(data, sourceWidth, channels, top) < rowContentThreshold) {
    top += 1;
  }

  let bottom = sourceHeight - 1;
  while (bottom >= top && countNonBackgroundInRow(data, sourceWidth, channels, bottom) < rowContentThreshold) {
    bottom -= 1;
  }

  let left = 0;
  while (left < sourceWidth && countNonBackgroundInColumn(data, sourceWidth, sourceHeight, channels, left) < columnContentThreshold) {
    left += 1;
  }

  let right = sourceWidth - 1;
  while (right >= left && countNonBackgroundInColumn(data, sourceWidth, sourceHeight, channels, right) < columnContentThreshold) {
    right -= 1;
  }

  if (top > bottom || left > right) {
    return undefined;
  }

  const crop = {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1
  };

  if (crop.width < AUTO_CROP_MIN_SIZE || crop.height < AUTO_CROP_MIN_SIZE) {
    return undefined;
  }

  if (crop.left === 0 && crop.top === 0 && crop.width === sourceWidth && crop.height === sourceHeight) {
    return undefined;
  }

  return crop;
}

function countNonBackgroundInRow(data: Buffer, width: number, channels: number, y: number): number {
  let count = 0;
  for (let x = 0; x < width; x += 1) {
    if (!isBackgroundPixel(data, pixelOffset(width, channels, x, y))) {
      count += 1;
    }
  }
  return count;
}

function countNonBackgroundInColumn(data: Buffer, width: number, height: number, channels: number, x: number): number {
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    if (!isBackgroundPixel(data, pixelOffset(width, channels, x, y))) {
      count += 1;
    }
  }
  return count;
}

function pixelOffset(width: number, channels: number, x: number, y: number): number {
  return (y * width + x) * channels;
}

function isBackgroundPixel(data: Buffer, offset: number): boolean {
  const alpha = data[offset + 3];
  if (alpha === 0) {
    return true;
  }

  return data[offset] <= AUTO_CROP_BLACK_THRESHOLD &&
    data[offset + 1] <= AUTO_CROP_BLACK_THRESHOLD &&
    data[offset + 2] <= AUTO_CROP_BLACK_THRESHOLD;
}

function encode(image: sharp.Sharp, format: LlmVisionFormat, quality: number): sharp.Sharp {
  switch (format) {
    case "jpeg":
      return image.jpeg({ quality });
    case "webp":
      return image.webp({ quality });
    case "png":
      return image.png();
  }
}

function mediaTypeForFormat(format: LlmVisionFormat): VisionImageInput["mediaType"] {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "png":
      return "image/png";
  }
}

function formatSequence(sequence: number): string {
  return sequence.toString().padStart(6, "0");
}
