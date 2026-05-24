import { describe, expect, it } from "vitest";
import {
  optimizeGameBoyScreenshot,
  optimizeGameBoyScreenshotWithGrid,
} from "../src/screenshot-image";
import {
  createRgbaPng,
  createRgbaPngWithFilter,
  createRgbPng,
  readPngSize,
  readRgbaPixel,
} from "./png";

describe("optimizeGameBoyScreenshot", () => {
  it("center-crops RGBA 240x160 screenshots to exact 160x144 GB dimensions", () => {
    const optimized = optimizeGameBoyScreenshot(
      createRgbaPng({ width: 240, height: 160 })
    );

    expect(readPngSize(optimized)).toEqual({ width: 160, height: 144 });
  });

  it("center-crops RGB 240x160 screenshots to exact 160x144 GB dimensions", () => {
    const optimized = optimizeGameBoyScreenshot(
      createRgbPng({ width: 240, height: 160 })
    );

    expect(readPngSize(optimized)).toEqual({ width: 160, height: 144 });
  });

  it("center-crops actual 256x224 mGBA GB screenshots to exact 160x144 GB dimensions", () => {
    const optimized = optimizeGameBoyScreenshot(
      createRgbaPng({ width: 256, height: 224 })
    );

    expect(readPngSize(optimized)).toEqual({ width: 160, height: 144 });
  });

  it("overlays a 16x16 red GB movement guide grid on model screenshots", () => {
    const optimized = optimizeGameBoyScreenshotWithGrid(
      createRgbaPng({ width: 256, height: 224 })
    );

    expect(readPngSize(optimized)).toEqual({ width: 160, height: 144 });
    expect(readRgbaPixel(optimized, { x: 0, y: 7 })).toMatchObject({
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
    expect(readRgbaPixel(optimized, { x: 15, y: 7 })).toMatchObject({
      r: 63,
      g: 47,
      b: 110,
      a: 255,
    });
    expect(readRgbaPixel(optimized, { x: 16, y: 7 })).toMatchObject({
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
  });

  it("preserves screenshots that are not the expected 240x160 mGBA frame", () => {
    const screenshot = createRgbaPng({ width: 80, height: 72 });

    expect(optimizeGameBoyScreenshot(screenshot)).toBe(screenshot);
  });

  it("preserves screenshots with unsupported PNG scanline filters", () => {
    const screenshot = createRgbaPngWithFilter({
      filter: 5,
      width: 240,
      height: 160,
    });

    expect(optimizeGameBoyScreenshot(screenshot)).toBe(screenshot);
    expect(readPngSize(screenshot)).toEqual({ width: 240, height: 160 });
  });
});
