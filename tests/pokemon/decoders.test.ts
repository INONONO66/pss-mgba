import { describe, expect, it } from "vitest";
import { HarnessError } from "../../src/shared/errors.js";
import {
  decodeBattleFlag,
  decodeBigEndianWord,
  decodeCoordinates,
  decodeHitPoints,
  decodeLittleEndianWord,
  decodePartyCount,
  decodeUnsignedByte
} from "../../src/game/decoders.js";

describe("pokemon decoders", () => {
  it("decodes wIsInBattle flags", () => {
    expect(decodeBattleFlag(0)).toEqual({ kind: "none", raw: 0 });
    expect(decodeBattleFlag(1)).toEqual({ kind: "wild", raw: 1 });
    expect(decodeBattleFlag(2)).toEqual({ kind: "trainer", raw: 2 });
    expect(decodeBattleFlag(255)).toEqual({ kind: "lost", raw: 255 });
  });

  it("rejects unsupported battle flags as invalid RAM state", () => {
    expect(() => decodeBattleFlag(3)).toThrow(HarnessError);
    expect(() => decodeBattleFlag(3)).toThrow("unsupported battle flag");
  });

  it("decodes valid party counts and rejects impossible counts", () => {
    expect(decodePartyCount(0)).toBe(0);
    expect(decodePartyCount(6)).toBe(6);
    expect(() => decodePartyCount(7)).toThrow(HarnessError);
    expect(() => decodePartyCount(99)).toThrow("party size limit");
  });

  it("decodes map, tile, and block coordinates", () => {
    expect(
      decodeCoordinates({
        mapId: 0x01,
        y: 0x08,
        x: 0x0b,
        yBlock: 0x02,
        xBlock: 0x03
      })
    ).toEqual({
      mapId: 1,
      y: 8,
      x: 11,
      yBlock: 2,
      xBlock: 3
    });
  });

  it("decodes HP words using Game Boy little-endian byte ordering", () => {
    expect(decodeHitPoints(0x34, 0x12)).toBe(0x1234);
    expect(decodeLittleEndianWord(0x2d, 0x00, "fixtureHp")).toBe(45);
    expect(decodeBigEndianWord(0x12, 0x34, "fixtureHp")).toBe(0x1234);
  });

  it("rejects bytes outside unsigned 8-bit bounds", () => {
    expect(() => decodeUnsignedByte(-1, "negativeByte")).toThrow(HarnessError);
    expect(() => decodeUnsignedByte(256, "largeByte")).toThrow(HarnessError);
    expect(() => decodeCoordinates({ mapId: 0, y: 1.5, x: 0, yBlock: 0, xBlock: 0 })).toThrow(
      HarnessError
    );
  });
});
