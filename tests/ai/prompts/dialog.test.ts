import { describe, expect, it } from "vitest";
import { buildDialogContext } from "../../../src/ai/prompts/dialog.js";

describe("buildDialogContext", () => {
  it("renders dialog commands and strategy without raw", () => {
    const context = buildDialogContext();

    expect(context).toContain("dialog(action)");
    expect(context).toContain("choose(index)");
    expect(context).toContain("input_name(name)");
    expect(context).toContain("advance");

    expect(context).toContain("choose what progresses the game");
    expect(context).toContain("short name");
    expect(context).toContain("keep high-power damaging moves");

    expect(context).not.toContain("raw");
  });
});
