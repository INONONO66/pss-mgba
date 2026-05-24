import { readFile, writeFile } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const GBA_FRAME_WIDTH = 240;
const GBA_FRAME_HEIGHT = 160;
const MGBA_GB_FRAME_WIDTH = 256;
const MGBA_GB_FRAME_HEIGHT = 224;
const GB_WIDTH = 160;
const GB_HEIGHT = 144;

interface PngChunk {
  data: Buffer;
  type: string;
}

interface PngImage {
  bitDepth: number;
  colorType: number;
  height: number;
  pixels: Buffer;
  width: number;
}

export interface BlackFrameSample {
  blackPixelRatio: number;
  isBlackFrame: boolean;
  sampledPixels: number;
}

export function optimizeGameBoyScreenshot(image: Buffer): Buffer {
  return transformGameBoyScreenshot(image, { overlayGrid: false });
}

export function optimizeGameBoyScreenshotWithGrid(image: Buffer): Buffer {
  return transformGameBoyScreenshot(image, { overlayGrid: true });
}

export function sampleGameBoyBlackFrame(image: Buffer): BlackFrameSample {
  const png = decodePng(image);
  const crop = getGameBoyCrop(png);
  const bytesPerPixel = getBytesPerPixel(png.colorType);
  let pixels: Buffer | undefined;

  if (crop) {
    pixels = cropPixels({
      bytesPerPixel,
      height: GB_HEIGHT,
      pixels: png.pixels,
      sourceWidth: png.width,
      width: GB_WIDTH,
      x: crop.x,
      y: crop.y,
    });
  } else if (png.width === GB_WIDTH && png.height === GB_HEIGHT) {
    pixels = png.pixels;
  }

  if (!pixels) {
    return { blackPixelRatio: 0, isBlackFrame: false, sampledPixels: 0 };
  }

  let blackPixels = 0;
  const sampledPixels = GB_WIDTH * GB_HEIGHT;
  for (
    let offset = 0;
    offset < sampledPixels * bytesPerPixel;
    offset += bytesPerPixel
  ) {
    if (
      pixels[offset] <= 12 &&
      pixels[offset + 1] <= 12 &&
      pixels[offset + 2] <= 12
    ) {
      blackPixels += 1;
    }
  }

  const blackPixelRatio = blackPixels / sampledPixels;
  return {
    blackPixelRatio,
    isBlackFrame: blackPixelRatio >= 0.95,
    sampledPixels,
  };
}

function transformGameBoyScreenshot(
  image: Buffer,
  { overlayGrid }: { overlayGrid: boolean }
): Buffer {
  try {
    const png = decodePng(image);
    const crop = getGameBoyCrop(png);

    if (!crop) {
      return image;
    }

    const transformed = {
      ...png,
      height: GB_HEIGHT,
      pixels: cropPixels({
        bytesPerPixel: getBytesPerPixel(png.colorType),
        height: GB_HEIGHT,
        pixels: png.pixels,
        sourceWidth: png.width,
        width: GB_WIDTH,
        x: crop.x,
        y: crop.y,
      }),
      width: GB_WIDTH,
    };

    return encodePng(
      overlayGrid ? drawGameBoyMovementGrid(transformed) : transformed
    );
  } catch {
    return image;
  }
}

export async function readOptimizedGameBoyScreenshotBase64(
  path: string,
  { overlayGrid = false }: { overlayGrid?: boolean } = {}
): Promise<string> {
  const originalImage = await readFile(path);
  const optimizedImage = overlayGrid
    ? optimizeGameBoyScreenshotWithGrid(originalImage)
    : optimizeGameBoyScreenshot(originalImage);
  if (optimizedImage !== originalImage) {
    await writeFile(path, optimizedImage);
  }
  return optimizedImage.toString("base64");
}

function drawGameBoyMovementGrid(image: PngImage): PngImage {
  if (image.width !== GB_WIDTH || image.height !== GB_HEIGHT) {
    return image;
  }

  const bytesPerPixel = getBytesPerPixel(image.colorType);
  const pixels = Buffer.from(image.pixels);

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (x % 16 === 0 || y % 16 === 0) {
        blendGridPixel({
          bytesPerPixel,
          pixels,
          sourceWidth: image.width,
          x,
          y,
        });
      }
    }
  }

  return { ...image, pixels };
}

function blendGridPixel({
  bytesPerPixel,
  pixels,
  sourceWidth,
  x,
  y,
}: {
  bytesPerPixel: number;
  pixels: Buffer;
  sourceWidth: number;
  x: number;
  y: number;
}): void {
  const offset = (y * sourceWidth + x) * bytesPerPixel;
  // Solid red movement guide line for model-visible navigation cells.
  pixels[offset] = 255;
  pixels[offset + 1] = 0;
  pixels[offset + 2] = 0;
  if (bytesPerPixel === 4) {
    pixels[offset + 3] = 255;
  }
}

function getGameBoyCrop({
  height,
  width,
}: Pick<PngImage, "height" | "width">): { x: number; y: number } | undefined {
  if (width === GBA_FRAME_WIDTH && height === GBA_FRAME_HEIGHT) {
    return { x: 40, y: 8 };
  }
  if (width === MGBA_GB_FRAME_WIDTH && height === MGBA_GB_FRAME_HEIGHT) {
    return { x: 48, y: 40 };
  }
}

function decodePng(image: Buffer): PngImage {
  if (!image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG image");
  }

  const chunks = readChunks(image);
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR")?.data;

  if (!ihdr) {
    throw new Error("PNG is missing IHDR");
  }

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const compression = ihdr[10];
  const filter = ihdr[11];
  const interlace = ihdr[12];

  if (
    bitDepth !== 8 ||
    compression !== 0 ||
    filter !== 0 ||
    interlace !== 0 ||
    ![2, 6].includes(colorType)
  ) {
    throw new Error("Unsupported PNG format");
  }

  const idat = Buffer.concat(
    chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data)
  );
  const bytesPerPixel = getBytesPerPixel(colorType);

  return {
    bitDepth,
    colorType,
    height,
    pixels: unfilterScanlines({
      bytesPerPixel,
      data: inflateSync(idat),
      height,
      width,
    }),
    width,
  };
}

function encodePng(image: PngImage): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    createChunk("IHDR", createIhdr(image)),
    createChunk("IDAT", deflateSync(createUnfilteredScanlines(image))),
    createChunk("IEND", Buffer.alloc(0)),
  ]);
}

function readChunks(image: Buffer): PngChunk[] {
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset < image.length) {
    const length = image.readUInt32BE(offset);
    const type = image.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    chunks.push({ type, data: image.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4;

    if (type === "IEND") {
      break;
    }
  }

  return chunks;
}

function createIhdr({ bitDepth, colorType, height, width }: PngImage): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return ihdr;
}

function createChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(Buffer.concat([typeBuffer, data])),
    8 + data.length
  );
  return chunk;
}

function unfilterScanlines({
  bytesPerPixel,
  data,
  height,
  width,
}: {
  bytesPerPixel: number;
  data: Buffer;
  height: number;
  width: number;
}): Buffer {
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(stride * height);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = data[sourceOffset];
    sourceOffset += 1;
    const row = data.subarray(sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
    const previousRow =
      y === 0
        ? Buffer.alloc(stride)
        : pixels.subarray((y - 1) * stride, y * stride);
    const outputRow = pixels.subarray(y * stride, (y + 1) * stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? outputRow[x - bytesPerPixel] : 0;
      const above = previousRow[x];
      const upperLeft = x >= bytesPerPixel ? previousRow[x - bytesPerPixel] : 0;

      outputRow[x] =
        (row[x] + getFilterByte({ above, filter, left, upperLeft })) % 256;
    }
  }

  return pixels;
}

function getFilterByte({
  above,
  filter,
  left,
  upperLeft,
}: {
  above: number;
  filter: number;
  left: number;
  upperLeft: number;
}): number {
  if (filter === 0) {
    return 0;
  }
  if (filter === 1) {
    return left;
  }
  if (filter === 2) {
    return above;
  }
  if (filter === 3) {
    return Math.floor((left + above) / 2);
  }
  if (filter === 4) {
    return paeth(left, above, upperLeft);
  }
  throw new Error(`Unsupported PNG scanline filter: ${filter}`);
}

function createUnfilteredScanlines({
  colorType,
  height,
  pixels,
  width,
}: PngImage): Buffer {
  const stride = width * getBytesPerPixel(colorType);
  const data = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const targetOffset = y * (stride + 1);
    data[targetOffset] = 0;
    pixels.copy(data, targetOffset + 1, y * stride, (y + 1) * stride);
  }

  return data;
}

function cropPixels({
  bytesPerPixel,
  height,
  pixels,
  sourceWidth,
  width,
  x,
  y,
}: {
  bytesPerPixel: number;
  height: number;
  pixels: Buffer;
  sourceWidth: number;
  width: number;
  x: number;
  y: number;
}): Buffer {
  const sourceStride = sourceWidth * bytesPerPixel;
  const targetStride = width * bytesPerPixel;
  const cropped = Buffer.alloc(targetStride * height);

  for (let row = 0; row < height; row += 1) {
    pixels.copy(
      cropped,
      row * targetStride,
      (y + row) * sourceStride + x * bytesPerPixel,
      (y + row) * sourceStride + (x + width) * bytesPerPixel
    );
  }

  return cropped;
}

function getBytesPerPixel(colorType: number): number {
  return colorType === 6 ? 4 : 3;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);

  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function crc32(data: Buffer): number {
  let crc = 0xff_ff_ff_ff;

  for (const byte of data) {
    // biome-ignore lint/suspicious/noBitwiseOperators: CRC32 is defined with bitwise operations.
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      // biome-ignore lint/suspicious/noBitwiseOperators: CRC32 is defined with bitwise operations.
      crc = (crc >>> 1) ^ (crc & 1 ? 0xed_b8_83_20 : 0);
    }
  }

  // biome-ignore lint/suspicious/noBitwiseOperators: CRC32 is defined with bitwise operations.
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}
