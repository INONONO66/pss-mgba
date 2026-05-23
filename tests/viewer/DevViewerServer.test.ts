import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRunPaths } from "../../src/evidence/RunPaths.js";
import { startDevViewerServer } from "../../src/viewer/DevViewerServer.js";

interface VisionImagesResponse {
  readonly runId: string;
  readonly limit: number;
  readonly count: number;
  readonly images: Array<{ readonly fileName: string }>;
}

describe("DevViewerServer", () => {
  it("serves the live frame and latest LLM context images for one active run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dev-viewer-"));
    const evidenceDir = path.join(root, "runs");
    const paths = buildRunPaths(evidenceDir, "viewer-run");
    await mkdir(paths.visionDir, { recursive: true });
    await writeFile(path.join(paths.visionDir, "000001-frame-11.jpeg"), Buffer.from([1, 2, 3]));
    await writeFile(path.join(paths.visionDir, "000002-frame-22.png"), Buffer.from([4, 5, 6]));
    await writeFile(path.join(paths.visionDir, "000003-frame-33.webp"), Buffer.from([7, 8, 9]));
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const screenshots: string[] = [];
    const viewer = await startDevViewerServer({
      evidenceDir,
      runId: "viewer-run",
      visionImageLimit: 2,
      port: 0,
      tempDir: path.join(root, "tmp"),
      client: {
        async screenshot(targetPath) {
          if (targetPath === undefined) {
            throw new Error("target path required");
          }
          screenshots.push(targetPath);
          await writeFile(targetPath, pngBytes);
          return targetPath;
        }
      }
    });

    try {
      const html = await fetchText(`${viewer.url}/`);
      expect(html).toContain("Main game screen");
      expect(html).toContain("LLM context images");
      expect(html).toContain("Loading latest 2 processed input(s)");
      expect(html).toContain("/api/live-frame");
      expect(html).toContain("/api/vision-images");
      expect(html).toContain("setInterval(tick, 1000)");
      expect(html).toContain(".layout");
      expect(html).toContain(".image-cell");
      expect(html).toContain(".vision-wall");
      expect(html).toContain("#live-frame");
      expect(html).toContain(".vision-grid");
      expect(html).toContain(".vision-cell");
      expect(html).toContain("aspect-ratio: 1 / 1");
      expect(html).toContain("grid-template-columns: minmax(0, 3fr) minmax(0, 1fr)");
      expect(html).toContain("repeat(3, minmax(0, 1fr))");
      expect(html).not.toContain("base64");
      expect(html).not.toContain("data:image");

      const frameResponse = await fetch(`${viewer.url}/api/live-frame`);
      expect(frameResponse.headers.get("content-type")).toContain("image/png");
      expect(Buffer.from(await frameResponse.arrayBuffer())).toEqual(pngBytes);
      expect(screenshots).toHaveLength(1);

      const metadata = await fetchJson(`${viewer.url}/api/vision-images`);
      expect(metadata).toMatchObject({ runId: "viewer-run", limit: 2, count: 2 });
      expect(metadata.images.map((image) => image.fileName)).toEqual(["000002-frame-22.png", "000003-frame-33.webp"]);
      expect(JSON.stringify(metadata)).not.toContain("base64");

      const imageResponse = await fetch(`${viewer.url}/vision/000001-frame-11.jpeg`);
      expect(imageResponse.headers.get("content-type")).toContain("image/jpeg");
      expect(Buffer.from(await imageResponse.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));

      expect((await fetch(`${viewer.url}/vision/000999-frame-99.jpeg`)).status).toBe(404);
      expect((await fetch(`${viewer.url}/vision/..%2Fconfig.json`)).status).toBe(404);
    } finally {
      await viewer.close();
    }
  });
});

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return response.text();
}

async function fetchJson(url: string): Promise<VisionImagesResponse> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json() as VisionImagesResponse;
}
