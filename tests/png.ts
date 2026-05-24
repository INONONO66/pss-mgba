import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function createRgbaPng({
  height,
  width,
}: {
  height: number;
  width: number;
}): Buffer {
  return createPng({ bytesPerPixel: 4, colorType: 6, height, width });
}

export function createRgbaPngWithFilter({
  filter,
  height,
  width,
}: {
  filter: number;
  height: number;
  width: number;
}): Buffer {
  return createPng({ bytesPerPixel: 4, colorType: 6, filter, height, width });
}

export function createRgbPng({
  height,
  width,
}: {
  height: number;
  width: number;
}): Buffer {
  return createPng({ bytesPerPixel: 3, colorType: 2, height, width });
}

function createPng({
  bytesPerPixel,
  colorType,
  filter = 0,
  height,
  width,
}: {
  bytesPerPixel: number;
  colorType: number;
  filter?: number;
  height: number;
  width: number;
}): Buffer {
  const scanlineLength = 1 + width * bytesPerPixel;
  const raw = Buffer.alloc(scanlineLength * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * scanlineLength;
    raw[rowOffset] = filter;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * bytesPerPixel;
      raw[offset] = x % 256;
      raw[offset + 1] = y % 256;
      raw[offset + 2] = (x + y) % 256;
      if (bytesPerPixel === 4) {
        raw[offset + 3] = 255;
      }
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    createChunk("IHDR", createIhdr({ colorType, width, height })),
    createChunk("IDAT", deflateSync(raw)),
    createChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function readPngSize(data: Buffer | string): {
  height: number;
  width: number;
} {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "base64");

  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  };
}

function createIhdr({
  colorType,
  height,
  width,
}: {
  colorType: number;
  height: number;
  width: number;
}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
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

export function readRgbaPixel(
  data: Buffer | string,
  { x, y }: { x: number; y: number }
): { a: number; b: number; g: number; r: number } {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "base64");
  const inflated = require("node:zlib").inflateSync(
    extractIdat(buffer)
  ) as Buffer;
  const width = buffer.readUInt32BE(16);
  const colorType = buffer[25];
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = 1 + width * bytesPerPixel;
  const offset = y * stride + 1 + x * bytesPerPixel;
  return {
    r: inflated[offset],
    g: inflated[offset + 1],
    b: inflated[offset + 2],
    a: bytesPerPixel === 4 ? inflated[offset + 3] : 255,
  };
}

function extractIdat(buffer: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === "IDAT") {
      chunks.push(buffer.subarray(dataStart, dataEnd));
    }
    offset = dataEnd + 4;
    if (type === "IEND") {
      break;
    }
  }
  return Buffer.concat(chunks);
}
