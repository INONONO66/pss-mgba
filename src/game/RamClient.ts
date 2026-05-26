import { HarnessError } from "../shared/errors.js";
import type { MgbaHttpClient } from "../mgba/MgbaHttpClient.js";

export type RamClient = Pick<MgbaHttpClient, "read8" | "read16" | "readRange">;

export async function readRangeExact(client: RamClient, address: number, length: number, fieldName: string): Promise<Uint8Array> {
  const bytes = await client.readRange(address, length);
  if (bytes.length !== length) {
    throw new HarnessError("INVALID_RAM_STATE", `${fieldName} read returned an unexpected byte count`, {
      context: { fieldName, expectedLength: length, actualLength: bytes.length }
    });
  }

  return bytes;
}
