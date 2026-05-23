import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { buildRunPaths } from "../evidence/RunPaths.js";

export interface VisionImageListOptions {
  readonly evidenceDir: string;
  readonly runId: string;
  readonly limit?: number;
}

export interface ListedVisionImage {
  readonly fileName: string;
  readonly url: string;
  readonly bytes: number;
  readonly mtime: string;
  readonly step: number | null;
  readonly frame: number | null;
}

const supportedExtensions = new Set([".jpeg", ".jpg", ".png", ".webp"]);

export async function listLatestVisionImages(options: VisionImageListOptions): Promise<ListedVisionImage[]> {
  const limit = options.limit ?? 3;
  if (limit <= 0) {
    return [];
  }

  const paths = buildRunPaths(options.evidenceDir, options.runId);
  const entries = await listImageFileNames(paths.visionDir);
  const images = await Promise.all(entries.map(async (fileName) => {
    const fileStat = await stat(path.join(paths.visionDir, fileName));
    const sequence = parseVisionFileName(fileName);
    return {
      fileName,
      url: `/vision/${encodeURIComponent(fileName)}`,
      bytes: fileStat.size,
      mtime: fileStat.mtime.toISOString(),
      mtimeMs: fileStat.mtimeMs,
      step: sequence.step,
      frame: sequence.frame
    };
  }));

  return images
    .sort(compareContextOrder)
    .slice(Math.max(0, images.length - limit))
    .map(({ mtimeMs: _mtimeMs, ...image }) => image);
}

export function visionImageContentType(fileName: string): string | undefined {
  switch (path.extname(fileName).toLowerCase()) {
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return undefined;
  }
}

export function isSafeVisionFileName(fileName: string): boolean {
  return fileName.length > 0 &&
    !fileName.includes("/") &&
    !fileName.includes("\\") &&
    fileName !== "." &&
    fileName !== ".." &&
    supportedExtensions.has(path.extname(fileName).toLowerCase());
}

async function listImageFileNames(visionDir: string): Promise<string[]> {
  try {
    const entries = await readdir(visionDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isSafeVisionFileName(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

function parseVisionFileName(fileName: string): { step: number | null; frame: number | null } {
  const match = fileName.match(/^(\d+)-frame-(\d+)\.(?:jpe?g|png|webp)$/i);
  if (!match) {
    return { step: null, frame: null };
  }

  return { step: Number(match[1]), frame: Number(match[2]) };
}

function compareContextOrder(left: ListedVisionImage & { readonly mtimeMs: number }, right: ListedVisionImage & { readonly mtimeMs: number }): number {
  if (left.step !== null && right.step !== null && left.step !== right.step) {
    return left.step - right.step;
  }
  if (left.frame !== null && right.frame !== null && left.frame !== right.frame) {
    return left.frame - right.frame;
  }
  return left.mtimeMs - right.mtimeMs || left.fileName.localeCompare(right.fileName);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
