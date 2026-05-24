import { z } from "zod";
import { MGBA_BUTTONS } from "../mgba/MgbaTypes.js";
import type { Command, PolicyDecision as CommandPolicyDecision } from "./CommandTypes.js";

const DirectionSchema = z.enum(["up", "down", "left", "right"]);

const DialogActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("advance") }),
  z.strictObject({ kind: z.literal("choose"), index: z.int().min(0) }),
  z.strictObject({ kind: z.literal("input_name"), name: z.string().min(1).max(20) })
]);

const BattleActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fight"), move: z.string().min(1) }),
  z.strictObject({ kind: z.literal("item"), item: z.string().min(1) }),
  z.strictObject({ kind: z.literal("switch"), pokemon: z.string().min(1) }),
  z.strictObject({ kind: z.literal("run") })
]);

const RawInputSchema = z.strictObject({
  button: z.enum(MGBA_BUTTONS),
  frames: z.int().min(1).max(60)
});

export const CommandSchema: z.ZodType<Command> = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("navigate"), x: z.int().min(0), y: z.int().min(0) }),
  z.strictObject({ type: z.literal("interact"), direction: DirectionSchema.optional() }),
  z.strictObject({ type: z.literal("dialog"), action: DialogActionSchema }),
  z.strictObject({ type: z.literal("battle"), action: BattleActionSchema }),
  z.strictObject({ type: z.literal("wait"), frames: z.int().min(1).max(120) }),
  z.strictObject({
    type: z.literal("raw"),
    inputs: z.array(RawInputSchema).min(1).max(8),
    reason: z.string().min(1)
  })
]);

export const CommandPolicyDecisionSchema: z.ZodType<CommandPolicyDecision> = z.strictObject({
  command: CommandSchema,
  rationale: z.string().min(1).max(200)
});

export function createCommandJsonSchema(): unknown {
  return z.toJSONSchema(CommandPolicyDecisionSchema);
}
