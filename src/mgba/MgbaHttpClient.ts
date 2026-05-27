import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessError } from "../shared/errors.js";
import type { FrameNumber, HarnessErrorCode } from "../shared/types.js";
import type { MgbaButton } from "./MgbaTypes.js";

export type MgbaFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface MgbaHttpClientOptions {
  baseUrl: string | URL;
  fetchImpl?: MgbaFetch;
  screenshotDir?: string;
  timeoutMs?: number;
}

const DEFAULT_TAP_FRAMES = 5;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_SCREENSHOT_DIR = dirname(fileURLToPath(import.meta.url));

export class MgbaHttpClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: MgbaFetch;
  private readonly screenshotDir: string;
  private readonly timeoutMs: number;

  constructor(options: MgbaHttpClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.screenshotDir = options.screenshotDir ?? DEFAULT_SCREENSHOT_DIR;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async currentFrame(): Promise<FrameNumber> {
    return this.requestNumber("GET", "/core/currentframe");
  }

  async read8(address: number): Promise<number> {
    return this.requestNumber("GET", "/core/read8", { address: formatAddress(address) });
  }

  async read16(address: number): Promise<number> {
    return this.requestNumber("GET", "/core/read16", { address: formatAddress(address) });
  }

  async readRange(address: number, length: number): Promise<Uint8Array> {
    assertPositiveInteger(length, "length");
    const responseText = await this.requestText("GET", "/core/readrange", {
      address: formatAddress(address),
      length: String(length)
    });

    return parseByteRange(responseText, "/core/readrange");
  }

  async tapButton(button: MgbaButton, frames = DEFAULT_TAP_FRAMES): Promise<void> {
    assertPositiveInteger(frames, "frames");
    await this.requestText("POST", "/mgba-http/button/tap", { button });
  }

  async holdButton(button: MgbaButton, frames: number): Promise<void> {
    assertPositiveInteger(frames, "frames");
    await this.requestText("POST", "/mgba-http/button/hold", { button, duration: String(frames) });
  }

  async screenshot(path?: string): Promise<string> {
    const screenshotPath = path ?? join(this.screenshotDir, `screenshot-${Date.now()}.png`);
    await this.requestText("POST", "/core/screenshot", { path: screenshotPath }, "SCREENSHOT_FAILED");
    return screenshotPath;
  }

  async saveStateSlot(slot: number): Promise<void> {
    assertNonNegativeInteger(slot, "slot");
    await this.requestText("POST", "/core/savestateslot", { slot: String(slot) });
  }

  async loadStateSlot(slot: number): Promise<void> {
    assertNonNegativeInteger(slot, "slot");
    await this.requestText("POST", "/core/loadstateslot", { slot: String(slot) });
  }

  private async requestNumber(
    method: "GET" | "POST",
    path: string,
    query: Record<string, string> = {},
    errorCode: HarnessErrorCode = "MGBA_UNAVAILABLE"
  ): Promise<number> {
    const responseText = await this.requestText(method, path, query, errorCode);
    const parsed = Number(responseText.trim());

    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      throw new HarnessError(errorCode, "mGBA-http returned an invalid numeric response", {
        context: { endpoint: path, responseKind: "number" }
      });
    }

    return parsed;
  }

  private async requestText(
    method: "GET" | "POST",
    path: string,
    query: Record<string, string> = {},
    errorCode: HarnessErrorCode = "MGBA_UNAVAILABLE"
  ): Promise<string> {
    const url = this.buildUrl(path, query);

    try {
      const response = await this.fetchImpl(url, {
        method,
        signal: createTimeoutSignal(this.timeoutMs)
      });

      if (!response.ok) {
        throw new HarnessError(errorCode, "mGBA-http request failed", {
          context: { endpoint: path, status: response.status, statusText: response.statusText }
        });
      }

      return await response.text();
    } catch (error) {
      if (error instanceof HarnessError) {
        throw error;
      }

      throw new HarnessError(errorCode, "mGBA-http request could not be completed", {
        cause: error,
        context: { endpoint: path }
      });
    }
  }

  private buildUrl(path: string, query: Record<string, string>): string {
    const url = new URL(path, this.baseUrl);
    const params = new URLSearchParams(query);
    url.search = params.toString();
    return url.toString();
  }
}

function formatAddress(address: number): string {
  assertNonNegativeInteger(address, "address");
  return `0x${address.toString(16).toUpperCase().padStart(4, "0")}`;
}

function parseByteRange(responseText: string, endpoint: string): Uint8Array {
  const trimmed = responseText.trim();
  const parsedJson = parseJsonArray(trimmed);
  const values = parsedJson ?? parseCommaSeparatedBytes(trimmed);

  if (values === undefined) {
    throw new HarnessError("MGBA_UNAVAILABLE", "mGBA-http returned an invalid byte range response", {
      context: { endpoint, responseKind: "byteRange" }
    });
  }

  return Uint8Array.from(values);
}

function parseJsonArray(trimmed: string): number[] | undefined {
  if (!trimmed.startsWith("[")) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || !parsed.every(isByte)) {
      return undefined;
    }

    return parsed;
  } catch {
    return undefined;
  }
}

function parseCommaSeparatedBytes(trimmed: string): number[] | undefined {
  if (trimmed.length === 0) {
    return [];
  }

  const values = trimmed.split(",").map((part) => parseByte(part.trim()));
  if (values.some((value) => value === undefined)) {
    return undefined;
  }

  return values as number[];
}

function parseByte(value: string): number | undefined {
  const radix = value.toLowerCase().startsWith("0x") ? 16 : 16;
  const normalized = value.toLowerCase().startsWith("0x") ? value.slice(2) : value;

  if (!/^[0-9a-fA-F]{1,2}$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, radix);
  return isByte(parsed) ? parsed : undefined;
}

function isByte(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 && value <= 255;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new HarnessError("MGBA_UNAVAILABLE", `${name} must be a positive integer`, {
      context: { [name]: value }
    });
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new HarnessError("MGBA_UNAVAILABLE", `${name} must be a non-negative integer`, {
      context: { [name]: value }
    });
  }
}

function createTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal.timeout !== "function") {
    return undefined;
  }

  return AbortSignal.timeout(timeoutMs);
}
