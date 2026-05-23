import { describe, expect, it } from "vitest";
import { HarnessRunner, type RunnerEvidenceRecorder, type RunnerVisionProcessor } from "../../src/loop/HarnessRunner.js";
import type { Policy, PolicyInput, PokemonStateSnapshot, VisionImageInput } from "../../src/ai/Policy.js";
import type { PolicyDecision } from "../../src/control/ActionTypes.js";
import { formatDebugEvent } from "../../src/evidence/EventFormatter.js";
import { HarnessError } from "../../src/errors.js";
import { Stage1Detector } from "../../src/pokemon/Stage1Detector.js";
import { FullGameDetector } from "../../src/pokemon/FullGameDetector.js";
import type { HarnessConfig } from "../../src/config.js";

const baseConfig: Pick<HarnessConfig, "harnessRunId" | "harnessMode" | "loopMaxSteps" | "loopStepDelayMs" | "maxLlmCalls" | "aiProvider" | "llmVisionEnabled" | "llmVisionMaxImages"> = {
  harnessRunId: "runner-test",
  harnessMode: "stage1",
  loopMaxSteps: 20,
  loopStepDelayMs: 0,
  maxLlmCalls: 5,
  aiProvider: "heuristic",
  llmVisionEnabled: false,
  llmVisionMaxImages: 3
};

const waitDecision: PolicyDecision = {
  action: { type: "wait", frames: 1 },
  rationale: "Wait for state to settle.",
  confidence: 0.5,
  observedStateCitations: ["test=true"]
};

describe("HarnessRunner", () => {
  it("snapshots frame, state, screenshot metadata, and evidence safely", async () => {
    const evidence = new FakeEvidenceRecorder();
    const runner = createRunner({
      evidence,
      states: [state()],
      frames: [42],
      screenshots: ["/tmp/shot.png"]
    });

    await evidence.startRun({});
    const snapshot = await runner.snapshot(3);

    expect(snapshot).toMatchObject({
      step: 3,
      frame: 42,
      stateFile: "state-1.json",
      screenshot: { path: "/tmp/fake-run/raw-screenshots/000003.png", frame: 42, step: 3, note: "runner_snapshot" },
      screenshotEvidenceFile: "screenshot-1.json"
    });
    expect(evidence.states[0]).toMatchObject({ step: 3, frame: 42, state: state() });
    expect(evidence.screenshots[0]).toEqual({ path: "/tmp/fake-run/raw-screenshots/000003.png", frame: 42, step: 3, note: "runner_snapshot" });
  });

  it("runs until Stage 1 completion and writes checkpoint summary", async () => {
    const evidence = new FakeEvidenceRecorder();
    const controller = new FakeController();
    const policyInputs: PolicyInput[] = [];
    const runner = createRunner({
      evidence,
      controller,
      policy: {
        async chooseAction(input) {
          policyInputs.push(input);
          return waitDecision;
        }
      },
      states: [
        state(),
        state({ wPartyCount: 1 }),
        state({ wPartyCount: 1 }),
        state({ wPartyCount: 1, wIsInBattle: 1 }),
        state({ wPartyCount: 1, wIsInBattle: 0 })
      ]
    });

    const result = await runner.run();

    expect(result.status).toBe("completed");
    expect(result.totalSteps).toBe(5);
    expect(result.checkpoints).toMatchObject({ completed: true });
    expect(result.last20Actions).toHaveLength(5);
    expect(controller.actions).toHaveLength(5);
    expect(evidence.finished?.status).toBe("completed");
    expect(evidence.finished?.result).toMatchObject({ status: "completed", checkpoints: { completed: true } });
    expect(policyInputs[1]).toMatchObject({ step: 2 });
    expect(policyInputs[1]?.recentStates).toHaveLength(2);
    expect(policyInputs[1]?.recentActions).toHaveLength(1);
    expect(policyInputs.every((input) => input.visionImages === undefined)).toBe(true);
  });

  it("stores raw runner screenshots under the active run evidence directory", async () => {
    const evidence = new FakeEvidenceRecorder();
    const runner = createRunner({ evidence, budgets: { maxSteps: 1, repeatedStateThreshold: 10 } });

    await runner.run();

    expect(evidence.screenshotTargets).toEqual(["/tmp/fake-run/raw-screenshots/000001.png"]);
    expect(evidence.screenshots[0]).toMatchObject({ path: "/tmp/fake-run/raw-screenshots/000001.png" });
  });

  it("passes only the latest configured processed vision images when enabled", async () => {
    const policyInputs: PolicyInput[] = [];
    const visionProcessor = new FakeVisionProcessor();
    const runner = createRunner({
      config: { ...baseConfig, llmVisionEnabled: true, llmVisionMaxImages: 3 },
      policy: {
        async chooseAction(input) {
          policyInputs.push(input);
          return waitDecision;
        }
      },
      visionProcessor,
      states: [
        state({ wYCoord: 1 }),
        state({ wYCoord: 2 }),
        state({ wYCoord: 3 }),
        state({ wYCoord: 4 })
      ],
      budgets: { maxSteps: 4, repeatedStateThreshold: 10 },
      detector: new Stage1Detector({ stuckStepThreshold: 50 })
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_timeout");
    expect(visionProcessor.inputs.map((input) => input.step)).toEqual([1, 2, 3, 4]);
    expect(policyInputs[0]?.visionImages?.map((image) => image.step)).toEqual([1]);
    expect(policyInputs[1]?.visionImages?.map((image) => image.step)).toEqual([1, 2]);
    expect(policyInputs[2]?.visionImages?.map((image) => image.step)).toEqual([1, 2, 3]);
    expect(policyInputs[3]?.visionImages?.map((image) => image.step)).toEqual([2, 3, 4]);
    expect(JSON.stringify(policyInputs[3]?.visionImages)).not.toContain("base64");
    expect(JSON.stringify(policyInputs[3]?.visionImages)).not.toContain("data:image");
  });

  it("passes processed vision images to an OpenAI policy input on the first decision", async () => {
    const policyInputs: PolicyInput[] = [];
    const visionProcessor = new FakeVisionProcessor();
    const runner = createRunner({
      config: { ...baseConfig, aiProvider: "openai", llmVisionEnabled: true, llmVisionMaxImages: 3 },
      policy: {
        async chooseAction(input) {
          policyInputs.push(input);
          return waitDecision;
        }
      },
      visionProcessor,
      states: [state({ wYCoord: 1 })],
      budgets: { maxSteps: 1, repeatedStateThreshold: 10 },
      detector: new Stage1Detector({ stuckStepThreshold: 50 })
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_timeout");
    expect(policyInputs).toHaveLength(1);
    expect(policyInputs[0]?.visionImages).toEqual([expect.objectContaining({
      path: "/tmp/vision-1.jpg",
      mediaType: "image/jpeg",
      width: 160,
      height: 144,
      step: 1,
      frame: 1
    })]);
  });

  it("fails before policy selection when vision is enabled without a processor", async () => {
    const policyInputs: PolicyInput[] = [];
    const runner = createRunner({
      config: { ...baseConfig, llmVisionEnabled: true, llmVisionMaxImages: 3 },
      policy: {
        async chooseAction(input) {
          policyInputs.push(input);
          return waitDecision;
        }
      },
      states: [state({ wYCoord: 1 })],
      budgets: { maxSteps: 1, repeatedStateThreshold: 10 },
      detector: new Stage1Detector({ stuckStepThreshold: 50 })
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_mgba");
    expect(result.errorCode).toBe("SCREENSHOT_FAILED");
    expect(policyInputs).toHaveLength(0);
  });

  it("accepts a full-game detector contract and records harness mode in start config", async () => {
    const evidence = new FakeEvidenceRecorder();
    const runner = createRunner({
      evidence,
      config: { ...baseConfig, harnessMode: "full-game" },
      detector: new FullGameDetector(),
      states: [state({ wObtainedBadges: 0xff, badgeCount: 8 }), state({ mapId: 0x76, wCurMap: 0x76, hallOfFameComplete: true })]
    });

    const result = await runner.run();

    expect(result.status).toBe("completed");
    expect(result.checkpoints).toMatchObject({ completed: true });
    expect(result.detector.checkpoints).toMatchObject({ allBadgesObtained: true, hallOfFameCompleted: true });
    expect(evidence.started).toMatchObject({ harnessMode: "full-game" });
  });

  it("stops with failed_timeout when max steps is reached", async () => {
    const evidence = new FakeEvidenceRecorder();
    const runner = createRunner({
      evidence,
      states: [state({ wYCoord: 1 }), state({ wYCoord: 2 })],
      budgets: { maxSteps: 2, repeatedStateThreshold: 10 }
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_timeout");
    expect(result.errorCode).toBe("TIMEOUT");
    expect(result.totalSteps).toBe(2);
    expect(evidence.errors[0]).toMatchObject({ code: "TIMEOUT" });
    expect(evidence.finished?.status).toBe("failed_timeout");
  });

  it("treats omitted max steps as unlimited until detector completion", async () => {
    const evidence = new FakeEvidenceRecorder();
    const runner = createRunner({
      evidence,
      config: { ...baseConfig, loopMaxSteps: undefined },
      states: [
        state(),
        state({ wPartyCount: 1 }),
        state({ wPartyCount: 1 }),
        state({ wPartyCount: 1, wIsInBattle: 1 }),
        state({ wPartyCount: 1, wIsInBattle: 0 })
      ],
      budgets: { repeatedStateThreshold: 10 }
    });

    const result = await runner.run();

    expect(result.status).toBe("completed");
    expect(result.errorCode).toBeUndefined();
    expect(result.totalSteps).toBe(5);
    expect(evidence.errors).toHaveLength(0);
    expect(evidence.started).toMatchObject({ harnessMode: "stage1" });
    expect(evidence.started).not.toHaveProperty("loopMaxSteps", Infinity);
  });

  it("stops as stuck when repeated state hashes persist without detector progress", async () => {
    const evidence = new FakeEvidenceRecorder();
    const repeated = state({ wYCoord: 7 });
    const runner = createRunner({
      evidence,
      states: [repeated, repeated, repeated],
      budgets: { maxSteps: 10, repeatedStateThreshold: 3 },
      detector: new Stage1Detector({ stuckStepThreshold: 50 })
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_stuck");
    expect(result.errorCode).toBe("STUCK");
    expect(result.totalSteps).toBe(3);
    expect(evidence.errors[0]).toMatchObject({ code: "STUCK" });
  });

  it("maps mGBA, invalid-state, policy, and controller errors to safe final statuses", async () => {
    await expectFailure(
      createRunner({ frameError: new HarnessError("MGBA_UNAVAILABLE", "mGBA down") }),
      "failed_mgba",
      "MGBA_UNAVAILABLE"
    );
    await expectFailure(
      createRunner({ stateError: new HarnessError("INVALID_RAM_STATE", "bad RAM") }),
      "failed_invalid_state",
      "INVALID_RAM_STATE"
    );
    await expectFailure(
      createRunner({ policyError: new HarnessError("LLM_UNAVAILABLE", "model down") }),
      "failed_llm",
      "LLM_UNAVAILABLE"
    );
    await expectFailure(
      createRunner({ controllerError: new HarnessError("ACTION_REJECTED", "bad action") }),
      "failed_mgba",
      "ACTION_REJECTED"
    );
  });

  it("maps runner-owned LLM budget exhaustion and keeps only the last 20 actions", async () => {
    const states = Array.from({ length: 25 }, (_value, index) => state({ wYCoord: index }));
    const evidence = new FakeEvidenceRecorder();
    const runner = createRunner({
      evidence,
      config: { ...baseConfig, aiProvider: "openai", maxLlmCalls: 30 },
      states,
      budgets: { maxSteps: 25, maxLlmCalls: 25, repeatedStateThreshold: 30 },
      detector: new Stage1Detector({ stuckStepThreshold: 50 })
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_timeout");
    expect(result.last20Actions).toHaveLength(20);
    expect(result.last20Actions[0]?.step).toBe(6);
    expect(result.last20Actions[19]?.step).toBe(25);

    const budgetEvidence = new FakeEvidenceRecorder();
    const budgetRunner = createRunner({
      evidence: budgetEvidence,
      config: { ...baseConfig, aiProvider: "openai", maxLlmCalls: 1 },
      states: [state({ wYCoord: 1 }), state({ wYCoord: 2 })],
      budgets: { maxSteps: 10, maxLlmCalls: 1, repeatedStateThreshold: 10 }
    });

    const budgetResult = await budgetRunner.run();

    expect(budgetResult.status).toBe("failed_budget");
    expect(budgetResult.errorCode).toBe("BUDGET_EXCEEDED");
    expect(budgetEvidence.errors[0]).toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("treats omitted OpenAI LLM call budget as unlimited until detector completion", async () => {
    const evidence = new FakeEvidenceRecorder();
    const policyInputs: PolicyInput[] = [];
    const runner = createRunner({
      evidence,
      config: { ...baseConfig, aiProvider: "openai", maxLlmCalls: undefined },
      policy: {
        async chooseAction(input) {
          policyInputs.push(input);
          return waitDecision;
        }
      },
      states: [
        state(),
        state({ wPartyCount: 1 }),
        state({ wPartyCount: 1 }),
        state({ wPartyCount: 1, wIsInBattle: 1 }),
        state({ wPartyCount: 1, wIsInBattle: 0 })
      ],
      budgets: { maxSteps: 10, repeatedStateThreshold: 10 }
    });

    const result = await runner.run();

    expect(result.status).toBe("completed");
    expect(result.errorCode).toBeUndefined();
    expect(policyInputs).toHaveLength(5);
    expect(evidence.errors).toHaveLength(0);
    expect(evidence.started).not.toHaveProperty("maxLlmCalls", Infinity);
  });

  it("enforces explicit OpenAI LLM call budgets including zero", async () => {
    const oneCallPolicyInputs: PolicyInput[] = [];
    const oneCallEvidence = new FakeEvidenceRecorder();
    const oneCallRunner = createRunner({
      evidence: oneCallEvidence,
      config: { ...baseConfig, aiProvider: "openai", maxLlmCalls: 1 },
      policy: {
        async chooseAction(input) {
          oneCallPolicyInputs.push(input);
          return waitDecision;
        }
      },
      states: [state({ wYCoord: 1 }), state({ wYCoord: 2 })],
      budgets: { maxSteps: 10, maxLlmCalls: 1, repeatedStateThreshold: 10 }
    });

    const oneCallResult = await oneCallRunner.run();

    expect(oneCallResult.status).toBe("failed_budget");
    expect(oneCallResult.errorCode).toBe("BUDGET_EXCEEDED");
    expect(oneCallPolicyInputs).toHaveLength(1);
    expect(oneCallEvidence.errors[0]).toMatchObject({ code: "BUDGET_EXCEEDED" });

    const zeroCallPolicyInputs: PolicyInput[] = [];
    const zeroCallEvidence = new FakeEvidenceRecorder();
    const zeroCallRunner = createRunner({
      evidence: zeroCallEvidence,
      config: { ...baseConfig, aiProvider: "openai", maxLlmCalls: 0 },
      policy: {
        async chooseAction(input) {
          zeroCallPolicyInputs.push(input);
          return waitDecision;
        }
      },
      states: [state({ wYCoord: 1 })],
      budgets: { maxSteps: 10, maxLlmCalls: 0, repeatedStateThreshold: 10 }
    });

    const zeroCallResult = await zeroCallRunner.run();

    expect(zeroCallResult.status).toBe("failed_budget");
    expect(zeroCallResult.errorCode).toBe("BUDGET_EXCEEDED");
    expect(zeroCallPolicyInputs).toHaveLength(0);
    expect(zeroCallEvidence.errors[0]).toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("emits debug events after decision, action, error, and run finish records", async () => {
    const events: unknown[] = [];
    const evidence = new FakeEvidenceRecorder();
    const runner = createRunner({
      evidence,
      states: [state({ wYCoord: 1 })],
      budgets: { maxSteps: 1, repeatedStateThreshold: 10 },
      debugEventSink: (event) => events.push(event)
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_timeout");
    expect(events).toHaveLength(4);
    expect(events.map((event) => (event as { type: string }).type)).toEqual(["decision", "action", "error", "run_finished"]);
    expect(events[0]).toMatchObject({ type: "decision", payload: { step: 1, frame: 1, decision: { action: { type: "wait", frames: 1 } } } });
    expect(events[1]).toMatchObject({ type: "action", payload: { step: 1, frame: 1, action: { type: "wait", frames: 1 } } });
    expect(events[2]).toMatchObject({ type: "error", payload: { error: { code: "TIMEOUT" } } });
    expect(events[3]).toMatchObject({ type: "run_finished", payload: { status: "failed_timeout", result: { status: "failed_timeout" } } });
    expect(evidence.decisions).toHaveLength(1);
    expect(evidence.actions).toHaveLength(1);
    expect(evidence.errors).toHaveLength(1);
    expect(evidence.finished?.status).toBe("failed_timeout");
  });

  it("redacts secret-like debug log fields and sk tokens", () => {
    const line = formatDebugEvent({
      type: "decision",
      timestamp: "2026-05-22T00:00:00.000Z",
      payload: {
        step: 4,
        frame: 9,
        decision: {
          action: { type: "wait", frames: 1, authorization: "Bearer raw-token" },
          confidence: 0.4,
          rationale: `do not leak OPENAI_API_KEY=s${"k"}-unit-test-secret or token=raw-token`
        }
      }
    });

    expect(line).toContain("decision step=4 frame=9 action=");
    expect(line).toContain("confidence=0.4");
    expect(line).toContain("[REDACTED]");
    expect(line).not.toContain(`s${"k"}-unit-test-secret`);
    expect(line).not.toContain("raw-token");
    expect(line).not.toContain("Bearer raw-token");
  });
});

async function expectFailure(
  runner: HarnessRunner<PokemonStateSnapshot>,
  status: string,
  code: string
): Promise<void> {
  const result = await runner.run();
  expect(result.status).toBe(status);
  expect(result.errorCode).toBe(code);
  expect(JSON.stringify(result.error)).not.toContain(`s${"k"}-test-secret`);
}

function createRunner(overrides: {
  config?: Pick<HarnessConfig, "harnessRunId" | "harnessMode" | "loopMaxSteps" | "loopStepDelayMs" | "maxLlmCalls" | "aiProvider" | "llmVisionEnabled" | "llmVisionMaxImages">;
  evidence?: FakeEvidenceRecorder;
  controller?: FakeController;
  policy?: Policy;
  detector?: Stage1Detector | FullGameDetector;
  states?: PokemonStateSnapshot[];
  frames?: number[];
  screenshots?: string[];
  budgets?: { maxSteps?: number; repeatedStateThreshold?: number; maxLlmCalls?: number };
  visionProcessor?: RunnerVisionProcessor;
  frameError?: HarnessError;
  stateError?: HarnessError;
  policyError?: HarnessError;
  controllerError?: HarnessError;
  debugEventSink?: ConstructorParameters<typeof HarnessRunner<PokemonStateSnapshot>>[0]["debugEventSink"];
}): HarnessRunner<PokemonStateSnapshot> {
  const states = overrides.states ?? [state()];
  const frames = overrides.frames ?? states.map((_value, index) => index + 1);
  const screenshots = overrides.screenshots ?? states.map((_value, index) => `/tmp/shot-${index + 1}.png`);
  const evidence = overrides.evidence ?? new FakeEvidenceRecorder();
  const controller = overrides.controller ?? new FakeController(overrides.controllerError);
  const policy = overrides.policy ?? new FakePolicy(overrides.policyError);
  let stateIndex = 0;
  let frameIndex = 0;
  let screenshotIndex = 0;

  return new HarnessRunner({
    config: overrides.config ?? baseConfig,
    client: {
      async currentFrame() {
        if (overrides.frameError !== undefined) {
          throw overrides.frameError;
        }

        return frames[Math.min(frameIndex++, frames.length - 1)] ?? 1;
      },
      async screenshot(targetPath) {
        if (targetPath !== undefined && "screenshotTargets" in evidence) {
          evidence.screenshotTargets.push(targetPath);
          screenshotIndex += 1;
          return targetPath;
        }

        return screenshots[Math.min(screenshotIndex++, screenshots.length - 1)] ?? "/tmp/shot.png";
      }
    },
    stateReader: {
      async readState() {
        if (overrides.stateError !== undefined) {
          throw overrides.stateError;
        }

        return states[Math.min(stateIndex++, states.length - 1)] ?? state();
      }
    },
    policy,
    controller,
    evidence,
    detector: overrides.detector ?? new Stage1Detector({ stuckStepThreshold: 50 }),
    visionProcessor: overrides.visionProcessor,
    budgets: { stepDelayMs: 0, ...overrides.budgets },
    sleep: async () => {},
    now: fixedNow,
    debugEventSink: overrides.debugEventSink
  });
}

function state(overrides: Partial<PokemonStateSnapshot> = {}): PokemonStateSnapshot {
  return {
    wCurMap: 0,
    wYCoord: 6,
    wXCoord: 5,
    wPartyCount: 0,
    wIsInBattle: 0,
    ...overrides
  };
}

class FakePolicy implements Policy {
  constructor(private readonly error?: HarnessError) {}

  async chooseAction(): Promise<PolicyDecision> {
    if (this.error !== undefined) {
      throw this.error;
    }

    return waitDecision;
  }
}

class FakeController {
  readonly actions: unknown[] = [];

  constructor(private readonly error?: HarnessError) {}

  async execute(action: unknown): Promise<void> {
    if (this.error !== undefined) {
      throw this.error;
    }

    this.actions.push(action);
  }
}

class FakeEvidenceRecorder implements RunnerEvidenceRecorder {
  readonly paths = { runId: "fake-run", visionDir: "/tmp/fake-run/vision", rawScreenshotsDir: "/tmp/fake-run/raw-screenshots" };
  readonly states: unknown[] = [];
  readonly decisions: unknown[] = [];
  readonly actions: unknown[] = [];
  readonly screenshots: unknown[] = [];
  readonly screenshotTargets: string[] = [];
  readonly errors: unknown[] = [];
  started: unknown;
  finished: { status: string; result: unknown } | undefined;

  async startRun(config: unknown): Promise<void> {
    this.started = config;
  }

  async recordState(state: unknown): Promise<string> {
    this.states.push(state);
    return `state-${this.states.length}.json`;
  }

  async recordDecision(decision: unknown): Promise<void> {
    this.decisions.push(decision);
  }

  async recordAction(action: unknown): Promise<void> {
    this.actions.push(action);
  }

  async recordScreenshot(metadata: unknown): Promise<string> {
    this.screenshots.push(metadata);
    return `screenshot-${this.screenshots.length}.json`;
  }

  async recordError(error: unknown): Promise<string> {
    this.errors.push(error instanceof HarnessError ? error.toJSON() : error);
    return `error-${this.errors.length}.json`;
  }

  async finishRun(status: string, result?: unknown): Promise<unknown> {
    this.finished = { status, result };
    return this.finished;
  }
}

class FakeVisionProcessor implements RunnerVisionProcessor {
  readonly inputs: Array<{ sourcePath: string; step: number; frame: number }> = [];

  async process(input: { readonly sourcePath: string; readonly step: number; readonly frame: number }): Promise<VisionImageInput> {
    this.inputs.push(input);
    return {
      path: `/tmp/vision-${input.step}.jpg`,
      sourcePath: input.sourcePath,
      mediaType: "image/jpeg",
      width: 160,
      height: 144,
      step: input.step,
      frame: input.frame,
      crop: { left: 0, top: 0, width: 160, height: 144 },
      bytes: 100 + input.step,
      detail: "low"
    };
  }
}

function fixedNow(): Date {
  return new Date("2026-05-22T00:00:00.000Z");
}
