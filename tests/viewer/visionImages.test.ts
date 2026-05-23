import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRunPaths } from "../../src/evidence/RunPaths.js";
import { listLatestVisionImages } from "../../src/viewer/visionImages.js";

describe("listLatestVisionImages", () => {
  it("lists exactly the latest active-run processed vision images", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "vision-list-"));
    const active = buildRunPaths(evidenceDir, "active-run");
    const other = buildRunPaths(evidenceDir, "other-run");
    await mkdir(active.visionDir, { recursive: true });
    await mkdir(active.screenshotsDir, { recursive: true });
    await mkdir(other.visionDir, { recursive: true });

    await Promise.all([
      writeFile(path.join(active.visionDir, "000001-frame-10.jpeg"), "one"),
      writeFile(path.join(active.visionDir, "000002-frame-20.png"), "two"),
      writeFile(path.join(active.visionDir, "000003-frame-30.webp"), "three"),
      writeFile(path.join(active.visionDir, "000004-frame-40.jpg"), "four"),
      writeFile(path.join(active.visionDir, "notes.json"), "{}"),
      writeFile(path.join(active.screenshotsDir, "000005.png"), "raw"),
      writeFile(path.join(other.visionDir, "000999-frame-999.jpeg"), "other")
    ]);

    const images = await listLatestVisionImages({ evidenceDir, runId: "active-run", limit: 3 });

    expect(images.map((image) => image.fileName)).toEqual([
      "000002-frame-20.png",
      "000003-frame-30.webp",
      "000004-frame-40.jpg"
    ]);
    expect(images.map((image) => image.step)).toEqual([2, 3, 4]);
    expect(images.map((image) => image.frame)).toEqual([20, 30, 40]);
    expect(images.every((image) => image.url.startsWith("/vision/"))).toBe(true);
    expect(JSON.stringify(images)).not.toContain("base64");
    expect(JSON.stringify(images)).not.toContain("data:image");
  });

  it("returns an empty list before the first processed LLM vision image exists", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "vision-empty-"));

    await expect(listLatestVisionImages({ evidenceDir, runId: "empty-run" })).resolves.toEqual([]);
  });
});
