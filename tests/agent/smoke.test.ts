import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentEvent, AgentTool, AgentTools } from "@minpeter/pss-runtime";
import type { LanguageModel } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CommandAgentContext,
  type CommandAgentGameState,
  createCommandAgentContext,
} from "../../src/agent/CommandAgentContext.js";
import { CommandAgentRunner } from "../../src/agent/CommandAgentRunner.js";
import { createCommandTools } from "../../src/agent/command-tools.js";
import { createDynamicLlm } from "../../src/agent/dynamic-llm.js";
import { createMemoryTools } from "../../src/agent/memory-tools.js";
import { createSaveLoadTools } from "../../src/agent/saveload-tools.js";
import type { HarnessConfig } from "../../src/cli/config.js";
import { buildDevHarnessArgs, runDev } from "../../src/cli/dev.js";
import type {
  CommandResult,
  GameMode,
} from "../../src/control/CommandTypes.js";
import type { DetectorStatus } from "../../src/game/Detector.js";
import type { MgbaHttpClient } from "../../src/mgba/MgbaHttpClient.js";
import { createMiniState } from "../../src/session/mini-state-reader.js";
import type { InputResult } from "../../src/session/types.js";

const generateTextMock = vi.hoisted(() => vi.fn());
const executeCommandMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/executor/CommandExecutor.js", () => ({
  executeCommand: (...args: unknown[]) => executeCommandMock(...args),
}));

describe("agent integration smoke", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    generateTextMock.mockReset();
    executeCommandMock.mockReset();
    executeCommandMock.mockResolvedValue({
      status: "success",
      reason: "waited",
    } satisfies CommandResult);
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { force: true, recursive: true }))
    );
    tempDirs.splice(0, tempDirs.length);
  });

  it("initializes the command agent context without contacting mGBA", async () => {
    const evidenceDir = await tempDir(tempDirs);
    const context = createCommandAgentContext(
      fakeConfig({ evidenceDir, harnessRunId: "context-smoke" })
    );

    expect(context.config.harnessRunId).toBe("context-smoke");
    expect(context.client).toBeDefined();
    expect(context.controller).toBeDefined();
    expect(context.executionContext.inputGate).toBeDefined();
    expect(context.executionContext.mode).toBe("overworld");
    expect(typeof context.readGameState).toBe("function");
    expect(context.getLastGameState()).toBeUndefined();
  });

  it("creates a runtime LLM function from the dynamic LLM wrapper", async () => {
    generateTextMock.mockResolvedValueOnce({
      responseMessages: [{ role: "assistant", content: "ready" }],
    });
    const llm = createDynamicLlm({
      getContext: () => ({
        mode: "overworld",
        tools: { pokemon_wait: smokeTool() },
      }),
      generateTextImpl: generateTextMock as never,
      model: {} as LanguageModel,
      reasoning: "low",
    });

    const output = await llm({
      history: [{ role: "user", content: "observe" }],
      signal: new AbortController().signal,
    });

    expect(typeof llm).toBe("function");
    expect(output).toEqual([{ role: "assistant", content: "ready" }]);
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {},
        reasoning: "low",
        tools: expect.objectContaining({ pokemon_wait: expect.any(Object) }),
      })
    );
  });

  it("registers valid agent tools across command, memory, and save/load factories", () => {
    const tools = {
      ...createCommandTools(createMockContext()),
      ...createMemoryTools({
        read: vi.fn(() => []),
        write: vi.fn(async () => ({
          entry: {
            id: "mem-1",
            content: "note",
            createdAt: fixedNow().toISOString(),
          },
          evicted: 0,
          section: "notes",
          totalEntries: 1,
        })),
      } as never),
      ...createSaveLoadTools(createMockClient(), () => "overworld", {
        write: vi.fn(),
      }),
    } satisfies AgentTools;

    expect(Object.keys(tools).sort()).toEqual([
      "pokemon_battle",
      "pokemon_dialog",
      "pokemon_interact",
      "pokemon_load",
      "pokemon_load_rollback",
      "pokemon_memory_read",
      "pokemon_memory_write",
      "pokemon_navigate",
      "pokemon_save",
      "pokemon_wait",
    ]);
    for (const tool of Object.values(tools)) {
      expect(tool).toMatchObject({
        description: expect.any(String),
        inputSchema: expect.any(Object),
        execute: expect.any(Function),
      });
      expect(
        typeof (tool as { inputSchema: { safeParse: unknown } }).inputSchema
          .safeParse
      ).toBe("function");
    }
  });

  it("runs one command-agent turn with mocked LLM/tool execution and then shuts down", async () => {
    const evidenceDir = await tempDir(tempDirs);
    const context = createMockContext();
    const events: string[] = [];
    const llmCalls: string[] = [];
    const llmToolSets: string[][] = [];
    vi.resetModules();
    const dynamicLlmMock = () => ({
      buildInstructions: () => "mock system prompt",
      createDynamicLlm:
        ({
          getContext,
        }: {
          readonly getContext: () => { readonly tools?: AgentTools };
        }) =>
        async ({ signal }: { readonly signal: AbortSignal }) => {
          llmCalls.push("call");
          const tools = getContext().tools;
          llmToolSets.push(Object.keys(tools ?? {}).sort());
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (signal.aborted) {
            throw new Error("mock LLM aborted");
          }
          const tool = tools?.pokemon_wait as ExecutableTool | undefined;
          const output = await tool?.execute({ frames: 1 });
          return [
            {
              role: "assistant",
              content: [
                { type: "text", text: "Wait once, then re-observe." },
                {
                  type: "tool-call",
                  toolCallId: "wait-1",
                  toolName: "pokemon_wait",
                  input: { frames: 1 },
                },
              ],
            },
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "wait-1",
                  toolName: "pokemon_wait",
                  output,
                },
              ],
            },
          ];
        },
    });
    vi.doMock("../../src/agent/dynamic-llm", dynamicLlmMock);
    vi.doMock("../../src/agent/dynamic-llm.js", dynamicLlmMock);
    vi.doMock("../../src/agent/dynamic-llm.ts", dynamicLlmMock);
    const { CommandAgentRunner } = await import(
      "../../src/agent/CommandAgentRunner.js"
    );

    const runner = new CommandAgentRunner(
      fakeConfig({ evidenceDir, harnessRunId: "agent-smoke", loopMaxSteps: 1 }),
      {
        context,
        maxTurns: 1,
        model: {} as LanguageModel,
        now: fixedNow,
        onEvent: (event) => {
          events.push(event.type);
        },
        sessionKey: "smoke-session",
        sleep: async () => undefined,
      }
    );

    const result = await runner.run();

    expect(result).toMatchObject({
      status: "failed_budget",
      totalSteps: 1,
      totalTurns: 1,
    });
    expect(result.llmCalls).toBeGreaterThanOrEqual(1);
    expect(llmCalls.length).toBe(result.llmCalls);
    expect(llmToolSets).toEqual(
      llmToolSets.map(() => [
        "pokemon_interact",
        "pokemon_load",
        "pokemon_load_rollback",
        "pokemon_memory_read",
        "pokemon_memory_write",
        "pokemon_navigate",
        "pokemon_save",
        "pokemon_wait",
      ])
    );
    expect(result.commandHistory).toEqual([
      expect.objectContaining({
        command: { type: "wait", frames: 1 },
        result: { status: "success", reason: "waited" },
        step: 1,
      }),
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        "user-message",
        "turn-start",
        "step-start",
        "tool-call",
        "tool-result",
        "turn-abort",
      ])
    );
    expect(executeCommandMock).toHaveBeenCalledWith(
      { type: "wait", frames: 1 },
      expect.objectContaining({
        inputGate: expect.objectContaining({ press: expect.any(Function) }),
        mode: "overworld",
      })
    );
    expect(context.mapMemoryStore.flush).toHaveBeenCalledTimes(1);
    vi.doUnmock("../../src/agent/dynamic-llm");
    vi.doUnmock("../../src/agent/dynamic-llm.js");
    vi.doUnmock("../../src/agent/dynamic-llm.ts");
  });

  it("auto-advances non-choice dialog before asking the LLM again", async () => {
    const evidenceDir = await tempDir(tempDirs);
    const context = createMockContext({
      states: [
        gameState({ mode: "dialog", dialogText: "Hello there" }),
        gameState({ mode: "overworld", dialogText: "" }),
        gameState({ mode: "overworld", dialogText: "" }),
        gameState({ mode: "overworld", dialogText: "" }),
      ],
      choiceActive: false,
    });
    const llmToolSets: string[][] = [];
    vi.resetModules();
    const dynamicLlmMock = () => ({
      buildInstructions: () => "mock system prompt",
      createDynamicLlm:
        ({
          getContext,
        }: {
          readonly getContext: () => { readonly tools?: AgentTools };
        }) =>
        async () => {
          const tools = getContext().tools;
          llmToolSets.push(Object.keys(tools ?? {}).sort());
          await Promise.resolve();
          return [{ role: "assistant", content: "observed" }];
        },
    });
    vi.doMock("../../src/agent/dynamic-llm", dynamicLlmMock);
    vi.doMock("../../src/agent/dynamic-llm.js", dynamicLlmMock);
    vi.doMock("../../src/agent/dynamic-llm.ts", dynamicLlmMock);
    const { CommandAgentRunner } = await import(
      "../../src/agent/CommandAgentRunner.js"
    );

    try {
      const runner = new CommandAgentRunner(
        fakeConfig({
          evidenceDir,
          harnessRunId: "agent-dialog-auto",
          loopMaxSteps: 1,
        }),
        {
          context,
          maxTurns: 1,
          model: {} as LanguageModel,
          now: fixedNow,
          sessionKey: "dialog-auto-session",
          sleep: async () => undefined,
        }
      );

      const result = await runner.run();

      expect(result.commandHistory).toEqual([
        expect.objectContaining({
          command: { type: "dialog", action: { kind: "advance" } },
          result: { status: "success", reason: "waited" },
          step: 1,
        }),
      ]);
      expect(executeCommandMock).toHaveBeenCalledWith(
        { type: "dialog", action: { kind: "advance" } },
        expect.objectContaining({
          inputGate: expect.objectContaining({ press: expect.any(Function) }),
          mode: "dialog",
        })
      );
      expect(llmToolSets).toEqual([
        [
          "pokemon_interact",
          "pokemon_load",
          "pokemon_load_rollback",
          "pokemon_memory_read",
          "pokemon_memory_write",
          "pokemon_navigate",
          "pokemon_save",
          "pokemon_wait",
        ],
      ]);
    } finally {
      vi.doUnmock("../../src/agent/dynamic-llm");
      vi.doUnmock("../../src/agent/dynamic-llm.js");
      vi.doUnmock("../../src/agent/dynamic-llm.ts");
    }
  });

  it("keeps choice dialog for the LLM without exposing wait", async () => {
    const evidenceDir = await tempDir(tempDirs);
    const context = createMockContext({
      states: [
        gameState({ mode: "dialog", dialogText: "YES NO" }),
        gameState({ mode: "dialog", dialogText: "YES NO" }),
      ],
      choiceActive: true,
    });
    const llmToolSets: string[][] = [];
    vi.resetModules();
    const dynamicLlmMock = () => ({
      buildInstructions: () => "mock system prompt",
      createDynamicLlm:
        ({
          getContext,
        }: {
          readonly getContext: () => { readonly tools?: AgentTools };
        }) =>
        async () => {
          const tools = getContext().tools;
          llmToolSets.push(Object.keys(tools ?? {}).sort());
          await Promise.resolve();
          return [{ role: "assistant", content: "choose later" }];
        },
    });
    vi.doMock("../../src/agent/dynamic-llm", dynamicLlmMock);
    vi.doMock("../../src/agent/dynamic-llm.js", dynamicLlmMock);
    vi.doMock("../../src/agent/dynamic-llm.ts", dynamicLlmMock);
    const { CommandAgentRunner } = await import(
      "../../src/agent/CommandAgentRunner.js"
    );

    try {
      const runner = new CommandAgentRunner(
        fakeConfig({
          evidenceDir,
          harnessRunId: "agent-dialog-choice",
          loopMaxSteps: 1,
        }),
        {
          context,
          maxTurns: 1,
          model: {} as LanguageModel,
          now: fixedNow,
          sessionKey: "dialog-choice-session",
          sleep: async () => undefined,
        }
      );

      const result = await runner.run();

      expect(result.commandHistory).toEqual([]);
      expect(executeCommandMock).not.toHaveBeenCalled();
      expect(llmToolSets).toEqual([
        ["pokemon_dialog", "pokemon_memory_read", "pokemon_memory_write"],
      ]);
    } finally {
      vi.doUnmock("../../src/agent/dynamic-llm");
      vi.doUnmock("../../src/agent/dynamic-llm.js");
      vi.doUnmock("../../src/agent/dynamic-llm.ts");
    }
  });

  it("keeps legacy pnpm dev forwarding compatible without adding unsupported flags", async () => {
    expect(buildDevHarnessArgs([], "dev-run")).toEqual([
      "run",
      "--run-id",
      "dev-run",
    ]);
    expect(buildDevHarnessArgs([], "dev-run")).not.toEqual(
      expect.arrayContaining(["--policy", "--mode", "--vision", "--max-steps"])
    );

    const calls: string[] = [];
    const exitCode = await runDev(["--run-id", "legacy-dev"], createIo(), {
      loadConfig(env) {
        calls.push(`load:${env.HARNESS_RUN_ID}`);
        return fakeConfig({ harnessRunId: env.HARNESS_RUN_ID ?? "missing" });
      },
      startViewer(config) {
        calls.push(`viewer:${config.harnessRunId}`);
        return Promise.resolve({
          url: "http://127.0.0.1:8787",
          server: {} as never,
          close() {
            calls.push("viewer:closed");
            return Promise.resolve();
          },
        });
      },
      runCli(args) {
        calls.push(`run:${args.join(" ")}`);
        return Promise.resolve(0);
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      "load:legacy-dev",
      "viewer:legacy-dev",
      "run:run --run-id legacy-dev",
      "viewer:closed",
    ]);
  });

  describe("turn interruption only follows game actions", () => {
    it.skip("does not interrupt on memory tool results before a wait", async () => {
      const evidenceDir = await tempDir(tempDirs);
      const context = createMockContext();
      const events: string[] = [];
      const llmToolSets: string[][] = [];
      vi.resetModules();
      let llmCall = 0;

      const dynamicLlmMock = () => ({
        buildInstructions: () => "mock system prompt",
        createDynamicLlm:
          ({
            getContext,
          }: {
            readonly getContext: () => { readonly tools?: AgentTools };
          }) =>
          async () => {
            llmCall += 1;
            const tools = getContext().tools;
            llmToolSets.push(Object.keys(tools ?? {}).sort());
            if (llmCall === 1) {
              const memoryTool = tools?.pokemon_memory_read as
                | ExecutableTool
                | undefined;
              const memoryOutput = await memoryTool?.execute({
                section: "notes",
              });

              return [
                {
                  role: "assistant",
                  content: [
                    { type: "text", text: "Read memory, then wait." },
                    {
                      type: "tool-call",
                      toolCallId: "memory-1",
                      toolName: "pokemon_memory_read",
                      input: { section: "notes" },
                    },
                  ],
                },
                {
                  role: "tool",
                  content: [
                    {
                      type: "tool-result",
                      toolCallId: "memory-1",
                      toolName: "pokemon_memory_read",
                      output: memoryOutput,
                    },
                  ],
                },
              ];
            }

            if (llmCall === 2) {
              const waitTool = tools?.pokemon_wait as
                | ExecutableTool
                | undefined;
              const waitOutput = await waitTool?.execute({ frames: 1 });

              return [
                {
                  role: "assistant",
                  content: [
                    {
                      type: "tool-call",
                      toolCallId: "wait-1",
                      toolName: "pokemon_wait",
                      input: { frames: 1 },
                    },
                  ],
                },
                {
                  role: "tool",
                  content: [
                    {
                      type: "tool-result",
                      toolCallId: "wait-1",
                      toolName: "pokemon_wait",
                      output: waitOutput,
                    },
                  ],
                },
              ];
            }

            throw new Error(`unexpected llm call ${llmCall} in memory test`);
          },
      });

      vi.doMock("../../src/agent/dynamic-llm", dynamicLlmMock);
      vi.doMock("../../src/agent/dynamic-llm.js", dynamicLlmMock);
      vi.doMock("../../src/agent/dynamic-llm.ts", dynamicLlmMock);
      const { CommandAgentRunner } = await import(
        "../../src/agent/CommandAgentRunner.js"
      );

      try {
        const runner = new CommandAgentRunner(
          fakeConfig({
            evidenceDir,
            harnessRunId: "agent-smoke-memory",
            loopMaxSteps: 1,
          }),
          {
            context,
            maxTurns: 1,
            model: {} as LanguageModel,
            now: fixedNow,
            onEvent: (event) => {
              if (event.type === "tool-result") {
                events.push(`tool-result:${event.toolName}`);
                return;
              }
              events.push(event.type);
            },
            sessionKey: "smoke-memory-session",
            sleep: async () => undefined,
          }
        );

        const result = await runner.run();

        expect(result).toMatchObject({
          status: "failed_budget",
          totalSteps: 1,
          totalTurns: 1,
        });
        expect(events).toEqual(
          expect.arrayContaining([
            "tool-result:pokemon_memory_read",
            "tool-result:pokemon_wait",
            "turn-abort",
          ])
        );
        expect(events.indexOf("tool-result:pokemon_memory_read")).toBeLessThan(
          events.indexOf("tool-result:pokemon_wait")
        );
        expect(llmToolSets).toEqual([
          [
            "pokemon_interact",
            "pokemon_load",
            "pokemon_load_rollback",
            "pokemon_memory_read",
            "pokemon_memory_write",
            "pokemon_navigate",
            "pokemon_save",
            "pokemon_wait",
          ],
          [
            "pokemon_interact",
            "pokemon_load",
            "pokemon_load_rollback",
            "pokemon_memory_read",
            "pokemon_memory_write",
            "pokemon_navigate",
            "pokemon_save",
            "pokemon_wait",
          ],
        ]);
        expect(result.commandHistory).toEqual([
          expect.objectContaining({
            command: { type: "wait", frames: 1 },
            result: { status: "success", reason: "waited" },
            step: 1,
          }),
        ]);
      } finally {
        vi.doUnmock("../../src/agent/dynamic-llm");
        vi.doUnmock("../../src/agent/dynamic-llm.js");
        vi.doUnmock("../../src/agent/dynamic-llm.ts");
      }
    });

    it.skip("does not interrupt on save/load tool results before a wait", async () => {
      const evidenceDir = await tempDir(tempDirs);
      const context = createMockContext();
      const events: string[] = [];
      const llmToolSets: string[][] = [];
      vi.resetModules();
      let llmCall = 0;

      const dynamicLlmMock = () => ({
        buildInstructions: () => "mock system prompt",
        createDynamicLlm:
          ({
            getContext,
          }: {
            readonly getContext: () => { readonly tools?: AgentTools };
          }) =>
          async () => {
            llmCall += 1;
            const tools = getContext().tools;
            llmToolSets.push(Object.keys(tools ?? {}).sort());
            if (llmCall === 1) {
              const saveTool = tools?.pokemon_save as
                | ExecutableTool
                | undefined;
              const saveOutput = await saveTool?.execute({
                slot: 2,
                label: "smoke",
              });

              return [
                {
                  role: "assistant",
                  content: [
                    { type: "text", text: "Save, then wait." },
                    {
                      type: "tool-call",
                      toolCallId: "save-1",
                      toolName: "pokemon_save",
                      input: { slot: 2, label: "smoke" },
                    },
                  ],
                },
                {
                  role: "tool",
                  content: [
                    {
                      type: "tool-result",
                      toolCallId: "save-1",
                      toolName: "pokemon_save",
                      output: saveOutput,
                    },
                  ],
                },
              ];
            }

            if (llmCall === 2) {
              const waitTool = tools?.pokemon_wait as
                | ExecutableTool
                | undefined;
              const waitOutput = await waitTool?.execute({ frames: 1 });

              return [
                {
                  role: "assistant",
                  content: [
                    {
                      type: "tool-call",
                      toolCallId: "wait-1",
                      toolName: "pokemon_wait",
                      input: { frames: 1 },
                    },
                  ],
                },
                {
                  role: "tool",
                  content: [
                    {
                      type: "tool-result",
                      toolCallId: "wait-1",
                      toolName: "pokemon_wait",
                      output: waitOutput,
                    },
                  ],
                },
              ];
            }

            throw new Error(`unexpected llm call ${llmCall} in save test`);
          },
      });

      vi.doMock("../../src/agent/dynamic-llm", dynamicLlmMock);
      vi.doMock("../../src/agent/dynamic-llm.js", dynamicLlmMock);
      vi.doMock("../../src/agent/dynamic-llm.ts", dynamicLlmMock);
      const { CommandAgentRunner } = await import(
        "../../src/agent/CommandAgentRunner.js"
      );

      try {
        const runner = new CommandAgentRunner(
          fakeConfig({
            evidenceDir,
            harnessRunId: "agent-smoke-save",
            loopMaxSteps: 1,
          }),
          {
            context,
            maxTurns: 1,
            model: {} as LanguageModel,
            now: fixedNow,
            onEvent: (event) => {
              if (event.type === "tool-result") {
                events.push(`tool-result:${event.toolName}`);
                return;
              }
              events.push(event.type);
            },
            sessionKey: "smoke-save-session",
            sleep: async () => undefined,
          }
        );

        const result = await runner.run();

        expect(result).toMatchObject({
          status: "failed_budget",
          totalSteps: 1,
          totalTurns: 1,
        });
        expect(events).toEqual(
          expect.arrayContaining([
            "tool-result:pokemon_save",
            "tool-result:pokemon_wait",
            "turn-abort",
          ])
        );
        expect(events.indexOf("tool-result:pokemon_save")).toBeLessThan(
          events.indexOf("tool-result:pokemon_wait")
        );
        expect(llmToolSets).toEqual([
          [
            "pokemon_interact",
            "pokemon_load",
            "pokemon_load_rollback",
            "pokemon_memory_read",
            "pokemon_memory_write",
            "pokemon_navigate",
            "pokemon_save",
            "pokemon_wait",
          ],
          [
            "pokemon_interact",
            "pokemon_load",
            "pokemon_load_rollback",
            "pokemon_memory_read",
            "pokemon_memory_write",
            "pokemon_navigate",
            "pokemon_save",
            "pokemon_wait",
          ],
        ]);
        expect(result.commandHistory).toEqual([
          expect.objectContaining({
            command: { type: "wait", frames: 1 },
            result: { status: "success", reason: "waited" },
            step: 1,
          }),
        ]);
      } finally {
        vi.doUnmock("../../src/agent/dynamic-llm");
        vi.doUnmock("../../src/agent/dynamic-llm.js");
        vi.doUnmock("../../src/agent/dynamic-llm.ts");
      }
    });

    it.skip("interrupts on game-action tool results before later tool results", async () => {
      const evidenceDir = await tempDir(tempDirs);
      const context = createMockContext();
      const events: string[] = [];
      const llmToolSets: string[][] = [];
      vi.resetModules();
      let llmCall = 0;

      const dynamicLlmMock = () => ({
        buildInstructions: () => "mock system prompt",
        createDynamicLlm:
          ({
            getContext,
          }: {
            readonly getContext: () => { readonly tools?: AgentTools };
          }) =>
          async () => {
            llmCall += 1;
            const tools = getContext().tools;
            llmToolSets.push(Object.keys(tools ?? {}).sort());
            if (llmCall === 1) {
              const navigateTool = tools?.pokemon_navigate as
                | ExecutableTool
                | undefined;
              const navigateOutput = await navigateTool?.execute({
                x: 3,
                y: 4,
              });

              return [
                {
                  role: "assistant",
                  content: [
                    { type: "text", text: "Navigate, then wait." },
                    {
                      type: "tool-call",
                      toolCallId: "navigate-1",
                      toolName: "pokemon_navigate",
                      input: { x: 3, y: 4 },
                    },
                  ],
                },
                {
                  role: "tool",
                  content: [
                    {
                      type: "tool-result",
                      toolCallId: "navigate-1",
                      toolName: "pokemon_navigate",
                      output: navigateOutput,
                    },
                  ],
                },
              ];
            }

            throw new Error(`unexpected llm call ${llmCall} in navigate test`);
          },
      });

      vi.doMock("../../src/agent/dynamic-llm", dynamicLlmMock);
      vi.doMock("../../src/agent/dynamic-llm.js", dynamicLlmMock);
      vi.doMock("../../src/agent/dynamic-llm.ts", dynamicLlmMock);
      const { CommandAgentRunner } = await import(
        "../../src/agent/CommandAgentRunner.js"
      );

      try {
        const runner = new CommandAgentRunner(
          fakeConfig({
            evidenceDir,
            harnessRunId: "agent-smoke-navigate",
            loopMaxSteps: 1,
          }),
          {
            context,
            maxTurns: 1,
            model: {} as LanguageModel,
            now: fixedNow,
            onEvent: (event) => {
              if (event.type === "tool-result") {
                events.push(`tool-result:${event.toolName}`);
                return;
              }
              events.push(event.type);
            },
            sessionKey: "smoke-navigate-session",
            sleep: async () => undefined,
          }
        );

        const result = await runner.run();

        expect(result).toMatchObject({
          status: "failed_budget",
          totalSteps: 1,
          totalTurns: 1,
        });
        expect(events).toEqual(
          expect.arrayContaining(["tool-result:pokemon_navigate", "turn-abort"])
        );
        expect(events).not.toContain("tool-result:pokemon_wait");
        expect(llmToolSets).toEqual([
          "pokemon_interact",
          "pokemon_load",
          "pokemon_load_rollback",
          "pokemon_memory_read",
          "pokemon_memory_write",
          "pokemon_navigate",
          "pokemon_save",
          "pokemon_wait",
        ]);
        expect(result.commandHistory).toEqual([
          expect.objectContaining({
            command: { type: "navigate", x: 3, y: 4 },
            result: { status: "success", reason: "waited" },
            step: 1,
          }),
        ]);
      } finally {
        vi.doUnmock("../../src/agent/dynamic-llm");
        vi.doUnmock("../../src/agent/dynamic-llm.js");
        vi.doUnmock("../../src/agent/dynamic-llm.ts");
      }
    });
  });

  describe("consumeRunEvents gates interrupts by tool type", () => {
    const expectedStatus = "running";

    it("skips interrupt for memory results until a wait result arrives", async () => {
      const evidenceDir = await tempDir(tempDirs);
      await mkdir(path.join(evidenceDir, "agent-smoke-memory"), {
        recursive: true,
      });
      const runner = new CommandAgentRunner(
        fakeConfig({ evidenceDir, harnessRunId: "agent-smoke-memory" }),
        {
          context: createMockContext(),
          maxTurns: 1,
          model: {} as LanguageModel,
          now: fixedNow,
          sessionKey: "smoke-memory-session",
          sleep: async () => undefined,
        }
      );

      const aborted = { value: false };
      const turnLog = {
        reasoning: "",
        response: "",
        timeline: [],
        toolCalls: [],
      };
      let interruptCalls = 0;
      const status = await (runner as any).consumeRunEvents(
        interruptibleEvents(
          [
            {
              type: "tool-result",
              toolCallId: "memory-1",
              toolName: "pokemon_memory_read",
              output: { ok: true },
            },
            {
              type: "tool-result",
              toolCallId: "wait-1",
              toolName: "pokemon_wait",
              output: {
                command: { type: "wait", frames: 1 },
                result: { status: "success", reason: "waited" },
              },
            },
          ],
          aborted
        ),
        () => {
          interruptCalls += 1;
          aborted.value = true;
        },
        {} as AgentTools,
        turnLog
      );

      expect(turnLog.timeline).toEqual([
        expect.objectContaining({
          sequence: 1,
          type: "tool-result",
          toolName: "pokemon_memory_read",
        }),
        expect.objectContaining({
          sequence: 2,
          type: "tool-result",
          toolName: "pokemon_wait",
          isGameAction: true,
        }),
      ]);
      expect(turnLog.toolCalls).toEqual([
        expect.objectContaining({
          toolCallId: "memory-1",
          output: { ok: true },
        }),
        expect.objectContaining({
          toolCallId: "wait-1",
          output: expect.objectContaining({
            command: { type: "wait", frames: 1 },
          }),
        }),
      ]);
      expect(status).toBe(expectedStatus);
      expect(interruptCalls).toBe(1);
      expect((runner as any).commandHistory).toEqual([
        expect.objectContaining({
          command: { type: "wait", frames: 1 },
          result: { status: "success", reason: "waited" },
          step: 0,
        }),
      ]);
    });

    it("skips interrupt for save/load results until a wait result arrives", async () => {
      const evidenceDir = await tempDir(tempDirs);
      await mkdir(path.join(evidenceDir, "agent-smoke-save"), {
        recursive: true,
      });
      const runner = new CommandAgentRunner(
        fakeConfig({ evidenceDir, harnessRunId: "agent-smoke-save" }),
        {
          context: createMockContext(),
          maxTurns: 1,
          model: {} as LanguageModel,
          now: fixedNow,
          sessionKey: "smoke-save-session",
          sleep: async () => undefined,
        }
      );

      const aborted = { value: false };
      let interruptCalls = 0;
      const status = await (runner as any).consumeRunEvents(
        interruptibleEvents(
          [
            {
              type: "tool-result",
              toolCallId: "save-1",
              toolName: "pokemon_save",
              output: { action: "pokemon_save", ok: true, slot: 2 },
            },
            {
              type: "tool-result",
              toolCallId: "wait-1",
              toolName: "pokemon_wait",
              output: {
                command: { type: "wait", frames: 1 },
                result: { status: "success", reason: "waited" },
              },
            },
          ],
          aborted
        ),
        () => {
          interruptCalls += 1;
          aborted.value = true;
        },
        {} as AgentTools
      );

      expect(status).toBe(expectedStatus);
      expect(interruptCalls).toBe(1);
      expect((runner as any).commandHistory).toEqual([
        expect.objectContaining({
          command: { type: "wait", frames: 1 },
          result: { status: "success", reason: "waited" },
          step: 0,
        }),
      ]);
    });

    it("interrupts immediately for game-action results", async () => {
      const evidenceDir = await tempDir(tempDirs);
      await mkdir(path.join(evidenceDir, "agent-smoke-navigate"), {
        recursive: true,
      });
      const runner = new CommandAgentRunner(
        fakeConfig({ evidenceDir, harnessRunId: "agent-smoke-navigate" }),
        {
          context: createMockContext(),
          maxTurns: 1,
          model: {} as LanguageModel,
          now: fixedNow,
          sessionKey: "smoke-navigate-session",
          sleep: async () => undefined,
        }
      );

      const aborted = { value: false };
      let interruptCalls = 0;
      const status = await (runner as any).consumeRunEvents(
        interruptibleEvents(
          [
            {
              type: "tool-result",
              toolCallId: "navigate-1",
              toolName: "pokemon_navigate",
              output: {
                command: { type: "navigate", x: 3, y: 4 },
                result: { status: "success", reason: "waited" },
              },
            },
            {
              type: "tool-result",
              toolCallId: "wait-1",
              toolName: "pokemon_wait",
              output: {
                command: { type: "wait", frames: 1 },
                result: { status: "success", reason: "waited" },
              },
            },
          ],
          aborted
        ),
        () => {
          interruptCalls += 1;
          aborted.value = true;
        },
        {} as AgentTools
      );

      expect(status).toBe(expectedStatus);
      expect(interruptCalls).toBe(1);
      expect((runner as any).commandHistory).toEqual([
        expect.objectContaining({
          command: { type: "navigate", x: 3, y: 4 },
          result: { status: "success", reason: "waited" },
          step: 0,
        }),
      ]);
    });
  });

  async function* interruptibleEvents(
    events: readonly AgentEvent[],
    aborted: { value: boolean }
  ): AsyncIterable<AgentEvent> {
    await Promise.resolve();
    for (const event of events) {
      if (aborted.value) {
        return;
      }
      yield event;
    }
  }

  async function tempDir(target: string[]): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pss-agent-smoke-"));
    target.push(dir);
    return dir;
  }
});

interface ExecutableTool {
  execute(input: Record<string, unknown>): Promise<unknown> | unknown;
}

function smokeTool(): AgentTool {
  return {
    description: "smoke tool",
    inputSchema: { safeParse: () => ({ success: true }) } as never,
    execute: () => ({ ok: true }),
  } satisfies AgentTool;
}

function createMockContext(
  options: {
    readonly choiceActive?: boolean;
    readonly namingScreenActive?: boolean;
    readonly states?: CommandAgentGameState[];
  } = {}
): CommandAgentContext {
  const states = [...(options.states ?? [gameState()])];
  const state = states[0] ?? gameState();
  const executionContext = {
    fullState: state.fullState,
    inputGate: {
      press: vi.fn(async (button, frames) =>
        inputResult(button, frames, state.mode)
      ),
    },
    mapHeight: state.mapHeight,
    mapWidth: state.mapWidth,
    mode: "overworld" as GameMode,
  };
  const detectorStatus = {
    checkpoints: {},
    status: "running",
  } satisfies DetectorStatus;

  return {
    client: createMockClient(),
    config: fakeConfig({ harnessRunId: "mock-context" }),
    controller: {},
    currentWarps: [],
    detector: {
      getStatus: vi.fn(() => detectorStatus),
      update: vi.fn(() => detectorStatus),
    },
    dialogStateReader: {
      isChoiceActive: vi.fn(async () => options.choiceActive ?? false),
      isNamingScreenActive: vi.fn(
        async () => options.namingScreenActive ?? false
      ),
    },
    executionContext,
    getLastGameState: vi.fn(() => state),
    getLastWorld: vi.fn(() => undefined),
    interactStateReader: {},
    mapGraph: { renderForLLM: vi.fn(() => "map graph: Pallet Town") },
    mapMemory: {
      renderFullMap: vi.fn(() => "full map: Pallet Town"),
      renderMicro: vi.fn(() => "micro map"),
      tileAt: vi.fn(() => "floor"),
    },
    mapMemoryStore: {
      flush: vi.fn(async () => undefined),
      loadInto: vi.fn(async () => undefined),
      onUpdate: vi.fn(),
    },
    navigateMapSource: {},
    navigateWorldReader: {},
    readGameState: vi.fn(async () => states.shift() ?? gameState()),
    stateReader: {},
    updateMapGraph: vi.fn(),
    updateMapMemory: vi.fn(async () => undefined),
  } as unknown as CommandAgentContext;
}

function inputResult(
  button: InputResult["intent"]["button"],
  frames: number,
  mode: GameMode
): InputResult {
  const state = createMiniState({
    battle: mode === "battle" ? 1 : 0,
    textBoxId: mode === "dialog" ? 1 : 0,
    letterDelay: 0,
    mapId: 0,
    y: 3,
    x: 2,
    partyCount: 1,
    walkCounter: 0,
    joyIgnore: 0,
    namingScreenType: 0,
    windowY: mode === "dialog" ? 112 : 144,
    screenText: "",
  });
  return {
    after: state,
    before: state,
    executed: true,
    intent: { button, frames, source: "agent" },
    transition: { after: state, before: state, kind: "none" },
  };
}

function createMockClient(): MgbaHttpClient {
  return {
    currentFrame: vi.fn(async () => 42),
    loadStateSlot: vi.fn(async () => undefined),
    read8: vi.fn(async () => 0),
    saveStateSlot: vi.fn(async () => undefined),
    screenshot: vi.fn(async (filePath: string) => filePath),
  } as unknown as MgbaHttpClient;
}

function gameState(
  options: { readonly dialogText?: string; readonly mode?: GameMode } = {}
): CommandAgentGameState {
  const mode = options.mode ?? "overworld";
  const dialogText = options.dialogText ?? "";
  return {
    facing: "down",
    fullState: {
      bag: [],
      battle: { enemy: undefined, inBattle: false, type: "none" },
      dialog: { active: mode === "dialog" },
      flags: { badges: { count: 0, names: [] } },
      map: { mapId: 0, mapName: "Pallet Town" },
      menuText: { screenText: dialogText },
      party: {
        members: [
          {
            nickname: "CHARMANDER",
            species: "Charmander",
            level: 5,
            hp: 19,
            maxHp: 19,
            status: "OK",
            moves: [],
          },
        ],
      },
      player: {
        badges: { count: 0, names: [] },
        facing: { direction: "down" },
        position: { x: 2, y: 3 },
      },
    } as unknown as CommandAgentGameState["fullState"],
    mapHeight: 18,
    mapId: 0,
    mapWidth: 20,
    mode,
    npcs: [],
    playerX: 2,
    playerY: 3,
    warps: [],
  };
}

function createIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    err,
    out,
    stderr(message: string) {
      err.push(message);
    },
    stdout(message: string) {
      out.push(message);
    },
  };
}

function fixedNow(): Date {
  return new Date("2026-05-26T00:00:00.000Z");
}

function fakeConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    aiProvider: "openai",
    defaultHoldFrames: 15,
    defaultTapFrames: 5,
    evidenceDir: "runs",
    harnessMode: "full-game",
    harnessRunId: "smoke-test",
    logLevel: "info",
    loopMaxSteps: 1,
    loopStepDelayMs: 0,
    mgbaHttpBaseUrl: "http://127.0.0.1:5001",
    openaiApiKey: "test-key",
    openaiBaseUrl: "http://127.0.0.1:3100/v1",
    openaiModel: "test-model",
    openaiTemperature: 0.2,
    pokemonVersion: "red",
    ...overrides,
  };
}
