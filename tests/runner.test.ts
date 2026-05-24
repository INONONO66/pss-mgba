import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import type {
  AgentEvent,
  AgentRun,
  RuntimeLlmOutput,
} from "@minpeter/pss-runtime";
import type { generateText, ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createReasoningLlm } from "../src/agent-llm";
import type { MgbaButton, MgbaStatus } from "../src/mgba-http";
import {
  createContinuationPrompt,
  createTurnPrompt,
  POKEMON_OBJECTIVE_PROMPT,
  type RunnerEvent,
  streamRun,
  streamSupervisedRun,
} from "../src/runner";
import { createMgbaControlPlane } from "../src/tools";

class FakeRun implements AgentRun {
  streamCalls = 0;
  readonly #events: AgentEvent[];

  constructor(events: AgentEvent[]) {
    this.#events = events;
  }

  stream(): AsyncIterable<AgentEvent> {
    this.streamCalls += 1;
    const events = this.#events;
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
        let index = 0;
        return {
          next: () =>
            Promise.resolve(
              index < events.length
                ? { done: false, value: events[index++] }
                : { done: true, value: undefined }
            ),
        };
      },
    };
  }
}

describe("POKEMON_OBJECTIVE_PROMPT", () => {
  it("hardcodes the autonomous Pokémon objective", () => {
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("already-loaded Pokémon game");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("without resetting");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("beat the game");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("Do not spam A");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("blocked terrain");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("open walkable space");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("solid black areas");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("out-of-room void");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("doorway, carpet, threshold");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("possible transition/exit");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("interactable-looking objects");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("Track recent action context");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("duration 12");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("taps duration 6");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("Unsafe long movement chains");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain(
      "<action_plan>...</action_plan>"
    );
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("medium-term goal");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("Do not stop");
  });
});

describe("supervised control tools", () => {
  it("does not expose reset, ROM loading, save-state, or load-state tools", () => {
    const tools = createMgbaControlPlane({
      client: new FakeMgbaClient([0]) as never,
    });

    expect(Object.keys(tools).sort()).toEqual([
      "mgba_hold",
      "mgba_hold_many",
      "mgba_release",
      "mgba_screenshot",
      "mgba_status",
      "mgba_tap",
      "mgba_tap_many",
    ]);
    expect(tools).not.toHaveProperty("mgba_reset");
    expect(tools).not.toHaveProperty("mgba_load_rom");
    expect(tools).not.toHaveProperty("mgba_save_state");
    expect(tools).not.toHaveProperty("mgba_load_state");
  });

  it("normalizes directional movement to duration 12 and settles to start frame plus 48", async () => {
    const client = new FakeMgbaClient([100, 110, 147, 148]);
    const interventions: string[] = [];
    const tools = createMgbaControlPlane({
      client: client as never,
      onSupervisorIntervention: (intervention) => {
        interventions.push(intervention.reason);
      },
    });

    const output = await executeTool(tools.mgba_hold.execute, {
      button: "Up",
      duration: 90,
    });

    expect(output).toEqual({ duration: 90, held: "Up", ok: true });
    expect(client.calls).toContain("hold:Up:12");
    expect(client.calls).not.toContain("hold:Up:90");
    expect(client.calls.filter((call) => call === "status")).toHaveLength(4);
    expect(interventions).toContain("long-movement-split");
    expect(interventions).toContain("settle-wait");
  });

  it("normalizes non-directional taps to duration 6", async () => {
    const client = new FakeMgbaClient([200, 248]);
    const tools = createMgbaControlPlane({ client: client as never });

    await executeTool(tools.mgba_tap.execute, { button: "A" });

    expect(client.calls).toContain("hold:A:6");
    expect(client.calls).not.toContain("tap:A");
  });

  it("rejects invalid buttons and directional multi-hold chains", async () => {
    const invalidClient = new FakeMgbaClient([0]);
    const invalidTools = createMgbaControlPlane({
      client: invalidClient as never,
    });

    await expect(
      executeTool(invalidTools.mgba_tap.execute, { button: "Turbo" })
    ).rejects.toThrow("invalid button");

    const chainClient = new FakeMgbaClient([0]);
    const chainTools = createMgbaControlPlane({ client: chainClient as never });

    await expect(
      executeTool(chainTools.mgba_hold_many.execute, {
        buttons: ["Up", "Right"],
        duration: 60,
      })
    ).rejects.toThrow("directional multi-button movement");
  });
});

describe("streamSupervisedRun", () => {
  it("waits through at most five black frames without additional LLM stream calls", async () => {
    const run = new FakeRun([{ type: "turn-start" }, { type: "turn-end" }]);
    const client = new FakeMgbaClient([0]);
    client.screenshotImages = [
      createPng(160, 144, [0, 0, 0]),
      createPng(160, 144, [10, 10, 10]),
      createPng(160, 144, [255, 255, 255]),
    ];
    const events: RunnerEvent[] = [];

    await streamSupervisedRun({
      client: client as never,
      onEvent: (event) => events.push(event),
      run,
    });

    expect(run.streamCalls).toBe(1);
    expect(client.screenshotCount).toBe(3);
    expect(
      events.filter((event) => event.type === "supervisor-intervention")
    ).toHaveLength(2);
  });

  it("stops black-frame polling at five screenshots", async () => {
    const run = new FakeRun([]);
    const client = new FakeMgbaClient([0]);
    client.screenshotImages = Array.from({ length: 8 }, () =>
      createPng(160, 144, [0, 0, 0])
    );

    await streamSupervisedRun({ client: client as never, run });

    expect(client.screenshotCount).toBe(5);
  });
});

class FakeMgbaClient {
  readonly calls: string[] = [];
  screenshotCount = 0;
  screenshotImages: Buffer[] = [];
  readonly #frames: number[];

  constructor(frames: number[]) {
    this.#frames = frames;
  }

  clear(button: MgbaButton): Promise<string> {
    this.calls.push(`clear:${button}`);
    return Promise.resolve("ok");
  }

  clearMany(buttons: readonly MgbaButton[]): Promise<string> {
    this.calls.push(`clearMany:${buttons.join("+")}`);
    return Promise.resolve("ok");
  }

  hold(button: MgbaButton, duration: number): Promise<string> {
    this.calls.push(`hold:${button}:${duration}`);
    return Promise.resolve("ok");
  }

  holdMany(buttons: readonly MgbaButton[], duration: number): Promise<string> {
    this.calls.push(`holdMany:${buttons.join("+")}:${duration}`);
    return Promise.resolve("ok");
  }

  async screenshot(path: string): Promise<string> {
    this.screenshotCount += 1;
    const image =
      this.screenshotImages.shift() ?? createPng(160, 144, [255, 255, 255]);
    await writeFile(path, image);
    return "ok";
  }

  status(): Promise<MgbaStatus> {
    this.calls.push("status");
    const frame = this.#frames.shift() ?? 9999;
    return Promise.resolve({
      activeButtons: [],
      frame,
      gameCode: "TEST",
      gameTitle: "TEST",
    });
  }

  tap(button: MgbaButton): Promise<string> {
    this.calls.push(`tap:${button}`);
    return Promise.resolve("ok");
  }

  tapMany(buttons: readonly MgbaButton[]): Promise<string> {
    this.calls.push(`tapMany:${buttons.join("+")}`);
    return Promise.resolve("ok");
  }
}

function createPng(
  width: number,
  height: number,
  [red, green, blue]: [number, number, number]
): Buffer {
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 3 + 1);
    pixels[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 3;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", createIhdr(width, height)),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function createIhdr(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return ihdr;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(Buffer.concat([typeBuffer, data])),
    8 + data.length
  );
  return chunk;
}

function crc32(data: Buffer): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of data) {
    // biome-ignore lint/suspicious/noBitwiseOperators: CRC32 is defined with bitwise operations.
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      // biome-ignore lint/suspicious/noBitwiseOperators: CRC32 is defined with bitwise operations.
      crc = (crc >>> 1) ^ (crc & 1 ? 0xed_b8_83_20 : 0);
    }
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: CRC32 is defined with bitwise operations.
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function executeTool(execute: unknown, input: unknown): Promise<unknown> {
  if (typeof execute !== "function") {
    throw new Error("Tool execute function missing");
  }
  return execute(input, {
    context: undefined,
    messages: [],
    toolCallId: "test-tool-call",
  });
}

describe("createTurnPrompt", () => {
  it("uses the hardcoded objective for the first observed send", () => {
    expect(createTurnPrompt(1)).toBe(POKEMON_OBJECTIVE_PROMPT);
  });

  it("uses the previous turn continuation for later observed sends", () => {
    expect(createTurnPrompt(8)).toBe(createContinuationPrompt(7));
  });
});

describe("createContinuationPrompt", () => {
  it("keeps the hardcoded objective and removes stop conditions", () => {
    const prompt = createContinuationPrompt(7);

    expect(prompt).toContain("Turn 7 ended");
    expect(prompt).toContain("Hardcoded objective:");
    expect(prompt).toContain(POKEMON_OBJECTIVE_PROMPT);
    expect(prompt).toContain("Never reset/reload/restart");
    expect(prompt).toContain("Avoid repeating A-only input");
    expect(prompt).toContain("recent action context");
    expect(prompt).toContain("Before calling any tool");
    expect(prompt).toContain("<action_plan>...</action_plan>");
    expect(prompt).toContain("There is no CLI prompt");
    expect(prompt).toContain("or stop condition");
  });
});

describe("streamRun", () => {
  it("forwards all events", async () => {
    const events: AgentEvent[] = [
      { type: "turn-start" },
      { type: "assistant-text", text: "first" },
      { type: "assistant-text", text: "done" },
      { type: "turn-end" },
    ];
    const forwarded: AgentEvent[] = [];

    await streamRun(new FakeRun(events), (event) => {
      forwarded.push(event);
    });

    expect(forwarded).toEqual(events);
  });
});

describe("createReasoningLlm retry", () => {
  it("retries the same observation twice for transient failures and succeeds on the third attempt", async () => {
    const history = [
      { role: "user", content: "same observation" },
    ] satisfies ModelMessage[];
    const calls: ModelMessage[][] = [];
    const responseMessages = [
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ] satisfies RuntimeLlmOutput;
    const generateTextImpl = vi.fn(({ messages }) => {
      calls.push(messages);
      if (calls.length < 3) {
        return Promise.reject(
          Object.assign(new Error("provider overloaded"), { status: 503 })
        );
      }
      return Promise.resolve({ responseMessages });
    }) as unknown as typeof generateText;
    const llm = createReasoningLlm({
      generateTextImpl,
      instructions: "test",
      model: {} as never,
      reasoning: "provider-default",
      sleep: async () => undefined,
      tools: {},
    });

    await expect(
      llm({ history, signal: new AbortController().signal })
    ).resolves.toBe(responseMessages);
    expect(generateTextImpl).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([history, history, history]);
  });

  it("fails fast for non-retryable errors", async () => {
    const error = Object.assign(new Error("bad request"), { status: 400 });
    const generateTextImpl = vi.fn(() =>
      Promise.reject(error)
    ) as unknown as typeof generateText;
    const llm = createReasoningLlm({
      generateTextImpl,
      instructions: "test",
      model: {} as never,
      reasoning: "provider-default",
      sleep: async () => undefined,
      tools: {},
    });

    await expect(
      llm({ history: [], signal: new AbortController().signal })
    ).rejects.toBe(error);
    expect(generateTextImpl).toHaveBeenCalledOnce();
  });
});
