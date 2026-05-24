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
  .describe(
    "버튼을 유지할 프레임 수. 로컬 supervisor가 최종 timing을 고정합니다: 방향키 단일 이동은 duration 12, A/B/Start/Select 등 비방향 입력은 duration 6입니다. 긴 방향키 입력은 안전을 위해 한 칸 단위로 축소됩니다."
  );
