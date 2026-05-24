import { describe, expect, it } from "vitest";
import { HarnessRunner, type RunnerEvidenceRecorder, type RunnerVisionProcessor } from "../../src/loop/HarnessRunner.js";
import type { Policy, PolicyInput, PokemonStateSnapshot, VisionImageInput } from "../../src/ai/Policy.js";
import type { PolicyDecision } from "../../src/control/ActionTypes.js";
import { HarnessError } from "../../src/errors.js";
import { Stage1Detector } from "../../src/pokemon/Stage1Detector.js";
import { FullGameDetector } from "../../src/pokemon/FullGameDetector.js";
import type { HarnessConfig } from "../../src/config.js";
import type { FullGameState } from "../../src/pokemon/PokemonTypes.js";
import type { GameWorldSnapshot } from "../../src/pokemon/GameWorld.js";
import { MapMemory } from "../../src/pokemon/MapMemory.js";

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

  it("injects full game state, summary, objective, and detector status into each policy input when available", async () => {
    const policyInputs: PolicyInput[] = [];
    const evidence = new FakeEvidenceRecorder();
    const runner = createRunner({
      evidence,
      policy: {
        async chooseAction(input) {
          policyInputs.push(input);
          return waitDecision;
        }
      },
      states: [state({ wCurMap: 38, wYCoord: 3, wXCoord: 3 })],
      fullStates: [fullState()],
      budgets: { maxSteps: 1, repeatedStateThreshold: 10 },
      detector: new Stage1Detector({ stuckStepThreshold: 50 })
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_timeout");
    expect(policyInputs).toHaveLength(1);
    expect(policyInputs[0]).toMatchObject({
      objective: expect.stringContaining("Stage 1"),
      fullState: expect.objectContaining({
        player: expect.objectContaining({ name: "AAAAAAA", money: 3000 }),
        map: expect.objectContaining({ mapName: "Reds House 2f" })
      }),
      detectorStatus: expect.objectContaining({
        status: "running",
        checkpoints: expect.objectContaining({ completed: false })
      })
    });
    expect(policyInputs[0]?.fullStateSummary).toContain("GAME STATE");
    expect(policyInputs[0]?.fullStateSummary).toContain("Reds House 2f");
    expect(policyInputs[0]?.fullStateError).toBeUndefined();
    expect(policyInputs[0]?.supervisorPlan).toMatchObject({
      version: 1,
      activeGoal: expect.objectContaining({
        kind: "advance-story",
        title: "Obtain the first party Pokemon"
      })
    });
    expect(policyInputs[0]?.supervisorPlan?.guidance.join("\n")).toContain("Current focus");
    expect(evidence.decisions[0]).toMatchObject({
      supervisor: {
        state: "progressing",
        activeGoal: {
          kind: "advance-story",
          title: "Obtain the first party Pokemon"
        },
        guidance: expect.arrayContaining([expect.stringContaining("Current focus")])
      }
    });
  });

  it("clears stale map context and reports map reader failures", async () => {
    const policyInputs: PolicyInput[] = [];
    const world = worldSnapshot();
    let worldReads = 0;
    const runner = createRunner({
      policy: {
        async chooseAction(input) {
          policyInputs.push(input);
          return waitDecision;
        }
      },
      states: [state({ wCurMap: 1, wYCoord: 4, wXCoord: 4 }), state({ wCurMap: 1, wYCoord: 5, wXCoord: 4 })],
      budgets: { maxSteps: 2, repeatedStateThreshold: 10 },
      mapMemory: new MapMemory(),
      worldReader: async () => {
        worldReads += 1;
        if (worldReads === 1) {
          return { world, tileMapBytes: world.tileMapBytes };
        }
        throw new Error("world reader unavailable");
      }
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_timeout");
    expect(policyInputs).toHaveLength(2);
    expect(policyInputs[0]?.mapAscii).toContain("@");
    expect(policyInputs[0]?.mapFresh).toBe(true);
    expect(policyInputs[0]?.mapStateError).toBeUndefined();
    expect(policyInputs[1]?.mapAscii).toBeUndefined();
    expect(policyInputs[1]?.walkGrid).toBeUndefined();
    expect(policyInputs[1]?.mapFresh).toBeUndefined();
    expect(policyInputs[1]?.mapStateError).toBe("world reader unavailable");
  });

  it("passes cached tile map bytes from the state read into the world reader", async () => {
    const policyInputs: PolicyInput[] = [];
    const cachedTileMap = Uint8Array.from(Array.from({ length: 360 }, () => 2));
    let observedTileMap: Uint8Array | undefined;
    const world = worldSnapshot({ tileMapBytes: cachedTileMap });
    const runner = createRunner({
      policy: {
        async chooseAction(input) {
          policyInputs.push(input);
          return waitDecision;
        }
      },
      states: [{
        ...state({ wCurMap: 1, wYCoord: 4, wXCoord: 4 }),
        menuText: fullState().menuText
      }],
      budgets: { maxSteps: 1, repeatedStateThreshold: 10 },
      mapMemory: new MapMemory(),
      lastTileMapBytes: cachedTileMap,
      worldReader: async (context) => {
        observedTileMap = context?.tileMapBytes;
        return { world, tileMapBytes: context?.tileMapBytes ?? world.tileMapBytes };
      }
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_timeout");
    expect(observedTileMap).toEqual(cachedTileMap);
    expect(policyInputs[0]?.mapFresh).toBe(true);
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
  fullStates?: FullGameState[];
  fullStateError?: HarnessError;
  frames?: number[];
  screenshots?: string[];
  budgets?: { maxSteps?: number; repeatedStateThreshold?: number; maxLlmCalls?: number };
  visionProcessor?: RunnerVisionProcessor;
  frameError?: HarnessError;
  stateError?: HarnessError;
  policyError?: HarnessError;
  controllerError?: HarnessError;
  mapMemory?: MapMemory;
  worldReader?: (context?: { readonly tileMapBytes?: Uint8Array }) => Promise<{ world: GameWorldSnapshot; tileMapBytes: Uint8Array }>;
  lastTileMapBytes?: Uint8Array;
}): HarnessRunner<PokemonStateSnapshot> {
  const states = overrides.states ?? [state()];
  const frames = overrides.frames ?? states.map((_value, index) => index + 1);
  const screenshots = overrides.screenshots ?? states.map((_value, index) => `/tmp/shot-${index + 1}.png`);
  const evidence = overrides.evidence ?? new FakeEvidenceRecorder();
  const controller = overrides.controller ?? new FakeController(overrides.controllerError);
  const policy = overrides.policy ?? new FakePolicy(overrides.policyError);
  let stateIndex = 0;
  let fullStateIndex = 0;
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
      },
      async readFullState() {
        if (overrides.fullStateError !== undefined) {
          throw overrides.fullStateError;
        }

        return overrides.fullStates?.[Math.min(fullStateIndex++, (overrides.fullStates?.length ?? 1) - 1)] ?? fullState();
      },
      getLastTileMapBytes() {
        return overrides.lastTileMapBytes;
      }
    },
    policy,
    controller,
    evidence,
    detector: overrides.detector ?? new Stage1Detector({ stuckStepThreshold: 50 }),
    visionProcessor: overrides.visionProcessor,
    mapMemory: overrides.mapMemory,
    worldReader: overrides.worldReader,
    budgets: { stepDelayMs: 0, ...overrides.budgets },
    sleep: async () => {},
    now: fixedNow
  });
}

function worldSnapshot(overrides: { readonly tileMapBytes?: Uint8Array } = {}): GameWorldSnapshot {
  return {
    mode: "overworld",
    modeFlags: {
      battle: 0,
      textBoxId: 0,
      letterDelay: 0,
      curMap: 1,
      yCoord: 4,
      xCoord: 4,
      partyCount: 1,
      walkCounter: 0,
      joyIgnore: 0,
      namingScreenType: 0,
      screenText: ""
    },
    tileMapBytes: overrides.tileMapBytes ?? Uint8Array.from(Array.from({ length: 360 }, () => 1)),
    mapLayout: { mapId: 1, tilesetId: 0, height: 10, width: 10, grid: [] },
    sprites: {
      player: {
        slot: 0,
        isPlayer: true,
        pictureId: 1,
        movementStatus: 0,
        yScreen: 64,
        xScreen: 64,
        facing: "down",
        mapY: 4,
        mapX: 4,
        inGrass: false,
        onScreen: true,
        movementType: "stationary"
      },
      npcs: [],
      spriteCount: 1
    },
    warps: { warps: [], connections: { north: undefined, south: undefined, west: undefined, east: undefined } },
    tileCollision: { tilesetId: 0, walkableTiles: new Set([1]), grassTile: undefined },
    playerCoords: { y: 4, x: 4 },
    tileInFront: 1,
    tileStandingOn: 1,
    grassRate: 0
  };
}

function fullState(overrides: Partial<FullGameState> = {}): FullGameState {
  return {
    player: {
      name: "AAAAAAA",
      rivalName: "AAAAAAA",
      money: 3000,
      position: { mapId: 38, y: 3, x: 3, yBlock: 1, xBlock: 1 },
      facing: { raw: 8, direction: "left" },
      badges: { raw: 0, count: 0, obtained: [false, false, false, false, false, false, false, false], names: [] },
      playTime: "1:38:18.22"
    },
    map: { mapId: 38, mapName: "Reds House 2f", tilesetId: 4, width: 4, height: 4 },
    party: { count: 0, members: [] },
    bag: [],
    battle: { inBattle: false, type: "none" },
    dialog: { active: false, textBoxId: 13, letterPrintingDelayFlags: 1, joyIgnore: 0 },
    flags: {
      hasPokedex: false,
      hasOaksParcel: false,
      deliveredOaksParcel: false,
      pokedexOwned: 0,
      pokedexSeen: 0,
      badges: { raw: 0, count: 0, obtained: [false, false, false, false, false, false, false, false], names: [] }
    },
    menuText: {
      currentMenuItem: 2,
      textBoxId: 13,
      letterPrintingDelayFlags: 1,
      screenText: "",
      screenTextKind: "none",
      namingScreenNameLength: 7,
      namingScreenSubmitName: 1,
      namingScreenType: 1
    },
    ...overrides
  };
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
