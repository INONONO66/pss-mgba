import { describe, expect, it } from "vitest";
import {
  findSessionAuthorityViolations,
  formatAuthorityViolations,
} from "../../scripts/check-session-authority.js";

describe("session authority guard", () => {
  it("allows low-level input only in approved owner and legacy files", () => {
    const violations = findSessionAuthorityViolations([
      {
        path: "src/session/input-gate.ts",
        text: "await controller.pressButton(button, frames);",
      },
      {
        path: "src/agent/CommandAgentRunner.ts",
        text: "await this.context.controller.pressButton('A', 5);",
      },
    ]);

    expect(violations).toEqual([]);
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
});
