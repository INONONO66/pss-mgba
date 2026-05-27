import { describe, expect, it } from "vitest";
import {
  findSessionAuthorityViolations,
  formatAuthorityViolations,
} from "../../scripts/check-session-authority.js";

describe("session authority guard", () => {
  it("allows low-level input only in approved owner and adapter files", () => {
    const violations = findSessionAuthorityViolations([
      {
        path: "src/session/input-gate.ts",
        text: "await controller.pressButton(button, frames);",
      },
      {
        path: "src/executor/command-router.ts",
        text: "await controller.pressButton(input.button, input.frames);",
      },
    ]);

    expect(violations).toEqual([]);
  });

  it("fails on direct runner or tool input primitives after session migration", () => {
    const violations = findSessionAuthorityViolations([
      {
        path: "src/agent/CommandAgentRunner.ts",
        text: "await this.context.controller.pressButton('A', 5);",
      },
      {
        path: "src/agent/command-tools.ts",
        text: "await context.executionContext.controller.pressButton('A', 16);",
      },
    ]);

    expect(violations).toEqual([
      {
        file: "src/agent/CommandAgentRunner.ts",
        line: 1,
        match: ".pressButton",
        rule: "low-level-input",
      },
      {
        file: "src/agent/CommandAgentRunner.ts",
        line: 1,
        match: "context.controller",
        rule: "agent-controller-bypass",
      },
      {
        file: "src/agent/command-tools.ts",
        line: 1,
        match: ".pressButton",
        rule: "low-level-input",
      },
      {
        file: "src/agent/command-tools.ts",
        line: 1,
        match: "context.executionContext.controller",
        rule: "agent-controller-bypass",
      },
    ]);
  });

  it("fails on unapproved production input primitives", () => {
    const violations = findSessionAuthorityViolations([
      {
        path: "src/new-feature/direct-input.ts",
        text: [
          "await client.holdButton('A', 5);",
          "await controller.execute({ type: 'press', button: 'A' });",
          "await controller?.execute({ type: 'press', button: 'B' });",
          "await controller . execute({ type: 'press', button: 'Start' });",
        ].join("\n"),
      },
    ]);

    expect(violations).toEqual([
      {
        file: "src/new-feature/direct-input.ts",
        line: 1,
        match: ".holdButton",
        rule: "low-level-input",
      },
      {
        file: "src/new-feature/direct-input.ts",
        line: 2,
        match: "controller.execute",
        rule: "low-level-input",
      },
      {
        file: "src/new-feature/direct-input.ts",
        line: 3,
        match: "controller?.execute",
        rule: "low-level-input",
      },
      {
        file: "src/new-feature/direct-input.ts",
        line: 4,
        match: "controller . execute",
        rule: "low-level-input",
      },
    ]);
  });

  it("ignores test fixtures but reports duplicate production refresh authority", () => {
    const violations = findSessionAuthorityViolations([
      {
        path: "tests/session/input-gate.test.ts",
        text: "await fake.pressButton('A', 5);",
      },
      {
        path: "src/agent/new-refresh.ts",
        text: "async function refreshState() {}",
      },
    ]);

    expect(formatAuthorityViolations(violations)).toContain(
      "src/agent/new-refresh.ts:1 [duplicate-refresh-state] refreshState"
    );
  });

  it("reports new production auto-loop authorities outside AutoHandler", () => {
    const violations = findSessionAuthorityViolations([
      {
        path: "src/agent/new-auto-loop.ts",
        text: [
          "async function advanceDialog() {}",
          "async function advanceBattleEnd() {}",
          "async function handlePostBattle() {}",
          "async function handlePostWarp() {}",
        ].join("\n"),
      },
    ]);

    expect(violations).toEqual([
      {
        file: "src/agent/new-auto-loop.ts",
        line: 1,
        match: "advanceDialog",
        rule: "auto-loop-authority",
      },
      {
        file: "src/agent/new-auto-loop.ts",
        line: 2,
        match: "advanceBattleEnd",
        rule: "auto-loop-authority",
      },
      {
        file: "src/agent/new-auto-loop.ts",
        line: 3,
        match: "handlePostBattle",
        rule: "auto-loop-authority",
      },
      {
        file: "src/agent/new-auto-loop.ts",
        line: 4,
        match: "handlePostWarp",
        rule: "auto-loop-authority",
      },
    ]);
  });

  it("limits new auto-loop symbols in legacy auto-loop files", () => {
    const violations = findSessionAuthorityViolations([
      {
        path: "src/agent/CommandAgentRunner.ts",
        text: [
          "autoAdvanceDialog()",
          "autoAdvanceBattleLoss()",
          "autoAdvanceDialog()",
          "autoAdvanceBattleLoss()",
          "handlePostWarp()",
        ].join("\n"),
      },
    ]);

    expect(violations).toEqual([
      {
        file: "src/agent/CommandAgentRunner.ts",
        line: 5,
        match: "handlePostWarp",
        rule: "auto-loop-authority",
      },
    ]);
  });

  it("reports legacy tool-gating authorities outside the template resolver", () => {
    const violations = findSessionAuthorityViolations([
      {
        path: "src/agent/new-tool-gating.ts",
        text: [
          "const WAIT_TOOL_NAMES = ['pokemon_wait'];",
          "const COMMON_TOOL_NAMES = ['pokemon_memory_read'];",
          "function selectToolsForMode() {}",
        ].join("\n"),
      },
      {
        path: "src/template/fragments/tools.ts",
        text: "const WAIT_TOOL_NAMES = ['pokemon_wait'];",
      },
    ]);

    expect(violations).toEqual([
      {
        file: "src/agent/new-tool-gating.ts",
        line: 1,
        match: "WAIT_TOOL_NAMES",
        rule: "tool-gating-authority",
      },
      {
        file: "src/agent/new-tool-gating.ts",
        line: 2,
        match: "COMMON_TOOL_NAMES",
        rule: "tool-gating-authority",
      },
      {
        file: "src/agent/new-tool-gating.ts",
        line: 3,
        match: "selectToolsForMode",
        rule: "tool-gating-authority",
      },
    ]);
  });

  it("reports agent-layer indirect controller bypasses", () => {
    const violations = findSessionAuthorityViolations([
      {
        path: "src/agent/command-tools.ts",
        text: [
          "new DialogExecutor(context.executionContext.controller, reader)",
          "context.controller",
        ].join("\n"),
      },
      {
        path: "src/executor/command-router.ts",
        text: "new DialogExecutor(controller, reader)",
      },
    ]);

    expect(violations).toEqual([
      {
        file: "src/agent/command-tools.ts",
        line: 1,
        match: "new DialogExecutor",
        rule: "agent-controller-bypass",
      },
      {
        file: "src/agent/command-tools.ts",
        line: 1,
        match: "context.executionContext.controller",
        rule: "agent-controller-bypass",
      },
      {
        file: "src/agent/command-tools.ts",
        line: 2,
        match: "context.controller",
        rule: "agent-controller-bypass",
      },
    ]);
  });
});
