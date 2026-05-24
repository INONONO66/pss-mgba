import { describe, expect, it } from "vitest";
import {
  CommandPolicyDecisionSchema,
  CommandSchema,
  createCommandJsonSchema
} from "../../src/control/CommandSchema.js";

describe("CommandSchema", () => {
  it("parses valid inputs for each command type", () => {
    const validCommands = [
      { type: "navigate", x: 12, y: 34 },
      { type: "interact" },
      { type: "interact", direction: "up" },
      { type: "dialog", action: { kind: "advance" } },
      { type: "dialog", action: { kind: "choose", index: 0 } },
      { type: "dialog", action: { kind: "input_name", name: "Ash" } },
      { type: "battle", action: { kind: "fight", move: "Tackle" } },
      { type: "battle", action: { kind: "item", item: "Potion" } },
      { type: "battle", action: { kind: "switch", pokemon: "Pikachu" } },
      { type: "battle", action: { kind: "run" } },
      { type: "wait", frames: 60 },
      {
        type: "raw",
        inputs: [{ button: "A", frames: 1 }],
        reason: "Fallback input sequence"
      }
    ] as const;

    for (const command of validCommands) {
      expect(CommandSchema.safeParse(command).success).toBe(true);
    }
  });

  it("rejects invalid command shapes and out-of-range values", () => {
    expect(CommandSchema.safeParse({ type: "navigate", x: -1, y: 0 }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "navigate", x: 1.5, y: 0 }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "interact", direction: "north" }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "dialog", action: { kind: "choose", index: -1 } }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "dialog", action: { kind: "input_name", name: "" } }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "battle", action: { kind: "fight", move: "" } }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "wait", frames: 0 }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "wait", frames: 121 }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "raw", inputs: [], reason: "fallback" }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "raw", inputs: [{ button: "A", frames: 0 }], reason: "fallback" }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "raw", inputs: [{ button: "L", frames: 1 }], reason: "fallback" }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "unknown" }).success).toBe(false);
  });

  it("parses valid policy decisions", () => {
    expect(
      CommandPolicyDecisionSchema.safeParse({
        command: { type: "wait", frames: 1 },
        rationale: "Pause briefly to observe the next frame."
      }).success
    ).toBe(true);
  });

  it("rejects rationale longer than 200 chars", () => {
    expect(
      CommandPolicyDecisionSchema.safeParse({
        command: { type: "wait", frames: 1 },
        rationale: "x".repeat(201)
      }).success
    ).toBe(false);
  });

  it("produces a JSON schema object", () => {
    const schema = createCommandJsonSchema();

    expect(schema).toEqual(expect.objectContaining({ $schema: expect.any(String) }));
    expect(typeof schema).toBe("object");
    expect(schema).not.toBeNull();
  });

  it("rejects negative coordinates, too many raw inputs, and oversized waits", () => {
    expect(CommandSchema.safeParse({ type: "navigate", x: -1, y: 2 }).success).toBe(false);
    expect(
      CommandSchema.safeParse({
        type: "raw",
        inputs: Array.from({ length: 9 }, () => ({ button: "A", frames: 1 })),
        reason: "fallback"
      }).success
    ).toBe(false);
    expect(CommandSchema.safeParse({ type: "wait", frames: 121 }).success).toBe(false);
  });
});
