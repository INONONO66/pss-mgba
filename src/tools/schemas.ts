import { z } from "zod";
import { MGBA_BUTTONS } from "../mgba-http";

export const buttonSchema = z.enum(MGBA_BUTTONS);

export const buttonsSchema = z
  .array(buttonSchema)
  .min(1)
  .max(4)
  .describe("동시에 누를 mGBA 버튼 목록. 예: ['Up'], ['A','B']");

export const durationSchema = z
  .number()
  .int()
  .min(1)
  .max(600)
  .default(6)
  .describe("버튼을 유지할 프레임 수. 60프레임은 약 1초입니다.");
