import { HarnessError } from "../errors.js";
import type { BattleFlag, PlayerFacing, PokemonCoordinates, StatusCondition } from "./PokemonTypes.js";

export function decodeUnsignedByte(value: number, fieldName = "byte"): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new HarnessError("INVALID_RAM_STATE", `${fieldName} must be an unsigned 8-bit value`, {
      context: { fieldName, value }
    });
  }

  return value;
}

export function decodeLittleEndianWord(lowByte: number, highByte: number, fieldName = "word"): number {
  const low = decodeUnsignedByte(lowByte, `${fieldName}.lowByte`);
  const high = decodeUnsignedByte(highByte, `${fieldName}.highByte`);

  return low | (high << 8);
}

export function decodeBigEndianWord(highByte: number, lowByte: number, fieldName = "word"): number {
  const high = decodeUnsignedByte(highByte, `${fieldName}.highByte`);
  const low = decodeUnsignedByte(lowByte, `${fieldName}.lowByte`);

  return (high << 8) | low;
}

export function decodeHitPoints(lowByte: number, highByte: number): number {
  return decodeLittleEndianWord(lowByte, highByte, "hitPoints");
}

export function decodeBigEndian24(highByte: number, middleByte: number, lowByte: number, fieldName = "u24"): number {
  const high = decodeUnsignedByte(highByte, `${fieldName}.highByte`);
  const middle = decodeUnsignedByte(middleByte, `${fieldName}.middleByte`);
  const low = decodeUnsignedByte(lowByte, `${fieldName}.lowByte`);

  return (high << 16) | (middle << 8) | low;
}

export function decodeBcd(bytes: Uint8Array, fieldName = "bcd"): number {
  let value = 0;
  for (const byte of bytes) {
    const checked = decodeUnsignedByte(byte, fieldName);
    const high = checked >> 4;
    const low = checked & 0x0f;
    if (high > 9 || low > 9) {
      throw new HarnessError("INVALID_RAM_STATE", `${fieldName} contains an invalid BCD digit`, {
        context: { fieldName, byte: checked }
      });
    }
    value = value * 100 + high * 10 + low;
  }
  return value;
}

export function countSetBits(bytes: Uint8Array, maxBits = bytes.length * 8): number {
  let count = 0;
  for (let i = 0; i < maxBits; i++) {
    if ((bytes[Math.floor(i / 8)] & (1 << (i % 8))) !== 0) count++;
  }
  return count;
}

export function decodeStatusCondition(rawValue: number): StatusCondition {
  const raw = decodeUnsignedByte(rawValue, "status");
  if (raw === 0) return "OK";

  const statuses: string[] = [];
  const sleepTurns = raw & 0x07;
  if (sleepTurns !== 0) statuses.push(`SLP(${sleepTurns})`);
  if ((raw & 0x08) !== 0) statuses.push("PSN");
  if ((raw & 0x10) !== 0) statuses.push("BRN");
  if ((raw & 0x20) !== 0) statuses.push("FRZ");
  if ((raw & 0x40) !== 0) statuses.push("PAR");

  return statuses.length > 0 ? statuses.join("|") : `UNKNOWN(${raw})`;
}

export function decodeBattleFlag(value: number): BattleFlag {
  const raw = decodeUnsignedByte(value, "wIsInBattle");

  switch (raw) {
    case 0:
      return { kind: "none", raw };
    case 1:
      return { kind: "wild", raw };
    case 2:
      return { kind: "trainer", raw };
    case 255:
      return { kind: "lost", raw };
    default:
      throw new HarnessError("INVALID_RAM_STATE", "wIsInBattle contains an unsupported battle flag", {
        context: { value: raw }
      });
  }
}

export function decodePartyCount(value: number): number {
  const count = decodeUnsignedByte(value, "wPartyCount");

  if (count > 6) {
    throw new HarnessError("INVALID_RAM_STATE", "wPartyCount cannot exceed the party size limit", {
      context: { value: count, maxPartySize: 6 }
    });
  }

  return count;
}

export function decodeCoordinates(raw: {
  mapId: number;
  y: number;
  x: number;
  yBlock: number;
  xBlock: number;
}): PokemonCoordinates {
  return {
    mapId: decodeUnsignedByte(raw.mapId, "wCurMap"),
    y: decodeUnsignedByte(raw.y, "wYCoord"),
    x: decodeUnsignedByte(raw.x, "wXCoord"),
    yBlock: decodeUnsignedByte(raw.yBlock, "wYBlockCoord"),
    xBlock: decodeUnsignedByte(raw.xBlock, "wXBlockCoord")
  };
}

export function decodePlayerFacing(value: number): PlayerFacing {
  const raw = decodeUnsignedByte(value, "wSpritePlayerStateData1FacingDirection");

  switch (raw) {
    case 0x00:
      return { raw, direction: "down" };
    case 0x04:
      return { raw, direction: "up" };
    case 0x08:
      return { raw, direction: "left" };
    case 0x0c:
      return { raw, direction: "right" };
    default:
      throw new HarnessError("INVALID_RAM_STATE", "wSpritePlayerStateData1FacingDirection contains an unsupported facing value", {
        context: { value: raw }
      });
  }
}
