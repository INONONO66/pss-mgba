import type { AgentEvent } from "@minpeter/pss-runtime";
import type { MgbaObservation } from "./observation";
import type { RunTrace } from "./run-trace";
import type { TokenUsageMetric } from "./token-usage";

export interface ObservationInjectionLog {
  nextTurn: number;
  observation: MgbaObservation;
}

export interface PrettyLoggerOptions {
  color?: boolean;
  write?: (line: string) => void;
}

interface RenderOptions {
  color: boolean;
}

type JsonObject = Record<string, unknown>;

const STATUS_FRAME_PATTERN = /frame: ([^\n]+)/;
const ACTION_BUTTON_VALUE_PATTERN =
  /((?:button|buttons|tapped|held|released)=)(\[[^\]]+\]|[^ ·]+)/g;

const COLORS = {
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  magenta: "\u001b[35m",
  red: "\u001b[31m",
  reset: "\u001b[0m",
  yellow: "\u001b[33m",
} as const;

export function createPrettyLogger({
  color = shouldUseColor(),
  write = (line) => console.log(line),
}: PrettyLoggerOptions = {}): {
  event: (event: AgentEvent) => void;
  observationInjection: (log: ObservationInjectionLog) => void;
  runTrace: (trace: RunTrace) => void;
  tokenUsage: (metric: TokenUsageMetric) => void;
} {
  const options = { color } satisfies RenderOptions;
  const writeSpaced = (line: string) => write(`${line}\n`);
  const pendingActionCalls = new Map<
    string,
    Extract<AgentEvent, { type: "tool-call" }>
  >();
  let suppressNextInjectedUserMessage = false;
  let totalSteps = 0;

  return {
    event: (event) => {
      if (
        event.type === "user-message" &&
        isInjectedUserMessage(event) &&
        suppressNextInjectedUserMessage
      ) {
        suppressNextInjectedUserMessage = false;
        return;
      }

      if (event.type === "step-start") {
        totalSteps += 1;
        if (totalSteps % 10 === 0) {
          writeSpaced(renderTotalStep(totalSteps, options));
        }
        return;
      }

      if (isLifecycleNoise(event)) {
        return;
      }

      if (event.type === "tool-call" && isActionTool(event.toolName)) {
        pendingActionCalls.set(event.toolCallId, event);
        return;
      }

      if (event.type === "tool-result" && isActionTool(event.toolName)) {
        const call = pendingActionCalls.get(event.toolCallId);
        pendingActionCalls.delete(event.toolCallId);
        writeSpaced(
          call
            ? renderCombinedAction(call, event, options)
            : renderAgentEvent(event, options)
        );
        return;
      }

      writeSpaced(renderAgentEvent(event, options));
    },
    observationInjection: (log) => {
      suppressNextInjectedUserMessage = true;
      writeSpaced(renderObservationInjection(log, options));
    },
    runTrace: (trace) => writeSpaced(renderRunTrace(trace, options)),
    tokenUsage: (metric) =>
      writeSpaced(renderTokenUsageMetric(metric, options)),
  };
}

export function renderAgentEvent(
  event: AgentEvent,
  { color = false }: Partial<RenderOptions> = {}
): string {
  const options = { color } satisfies RenderOptions;

  switch (event.type) {
    case "turn-start":
      return line(options, "cyan", "↻", "turn started");
    case "turn-end":
      return line(options, "green", "✓", "turn ended");
    case "turn-abort":
      return line(options, "yellow", "!", "turn aborted");
    case "turn-error":
      return line(options, "red", "✖", `turn error · ${event.message}`);
    case "step-start":
      return line(options, "dim", "•", "step started");
    case "step-end":
      return line(options, "dim", "•", "step ended");
    case "user-text":
      return line(options, "blue", "👤", `user · ${formatText(event.text)}`);
    case "assistant-text":
      return line(options, "green", "💬", `assistant · ${event.text}`);
    case "assistant-reasoning":
      return line(options, "magenta", "🧠", `reasoning · ${event.text}`);
    case "user-message":
      return renderUserMessage(event, options);
    case "tool-call":
      return renderToolCall(event, options);
    case "tool-result":
      return renderToolResult(event, options);
    default:
      return line(options, "dim", "?", formatValue(event));
  }
}

export function renderRunTrace(
  trace: RunTrace,
  { color = false }: Partial<RenderOptions> = {}
): string {
  return line(
    { color },
    "cyan",
    "🏁",
    `run ${trace.runId} · iteration ${trace.iteration} · metrics ${trace.metricsDir}`
  );
}

export function renderObservationInjection(
  { nextTurn, observation }: ObservationInjectionLog,
  { color = false }: Partial<RenderOptions> = {}
): string {
  const status = observation.status;
  return line(
    { color },
    "blue",
    "INJECT",
    `turn ${nextTurn} · frame ${formatMaybeNumber(status.frame)} · [status + screenshot + prompt] injected`
  );
}

export function renderTotalStep(
  totalSteps: number,
  { color = false }: Partial<RenderOptions> = {}
): string {
  return paint({ color }, "red", `[TOTAL STEP: ${formatNumber(totalSteps)}]`);
}

export function renderTokenUsageMetric(
  metric: TokenUsageMetric,
  { color = false }: Partial<RenderOptions> = {}
): string {
  const usage = metric.usage;
  if (metric.type === "turn-summary") {
    return line(
      { color },
      "yellow",
      "Σ",
      `turn ${metric.turn} summary · steps ${metric.steps} · tokens ${formatNumber(usage.totalTokens)} ` +
        `(in ${formatNumber(usage.inputTokens)} / out ${formatNumber(usage.outputTokens)} / reasoning ${formatNumber(usage.reasoningTokens)})`
    );
  }

  return line(
    { color },
    "magenta",
    "🤖",
    `step ${metric.step} · turn ${metric.turn} · ${metric.modelId} · tokens ${formatNumber(usage.totalTokens)} ` +
      `(in ${formatNumber(usage.inputTokens)} / out ${formatNumber(usage.outputTokens)} / reasoning ${formatNumber(usage.reasoningTokens)})`
  );
}

function isLifecycleNoise(event: AgentEvent): boolean {
  return ["turn-start", "turn-end", "step-end"].includes(event.type);
}

function renderUserMessage(
  event: Extract<AgentEvent, { type: "user-message" }>,
  options: RenderOptions
): string {
  const summary = summarizeInjectedUserMessage(event.content);
  if (summary) {
    return line(options, "blue", "INJECT", summary);
  }

  return line(
    options,
    "blue",
    "👤",
    `user · ${formatContentParts(event.content)}`
  );
}

function renderToolCall(
  event: Extract<AgentEvent, { type: "tool-call" }>,
  options: RenderOptions
): string {
  if (isActionTool(event.toolName)) {
    return line(
      options,
      "yellow",
      "ACTION",
      `${event.toolName.replace("mgba_", "")} ${formatActionDetails(formatValue(event.input), options)} ${dim(options, shortId(event.toolCallId))}`
    );
  }

  return line(
    options,
    "blue",
    toolIcon(event.toolName),
    `call ${event.toolName} ${dim(options, shortId(event.toolCallId))} · ${formatValue(event.input)}`
  );
}

function renderCombinedAction(
  call: Extract<AgentEvent, { type: "tool-call" }>,
  result: Extract<AgentEvent, { type: "tool-result" }>,
  options: RenderOptions
): string {
  const output = unwrapToolOutput(result.output);
  return line(
    options,
    "yellow",
    "ACTION",
    `${call.toolName.replace("mgba_", "")} ${formatActionDetails(formatValue(call.input), options)} → DONE ${formatActionDetails(formatToolOutput(result.toolName, output), options)} ${dim(options, shortId(call.toolCallId))}`
  );
}

function renderToolResult(
  event: Extract<AgentEvent, { type: "tool-result" }>,
  options: RenderOptions
): string {
  const output = unwrapToolOutput(event.output);
  if (isActionTool(event.toolName)) {
    return line(
      options,
      "green",
      "DONE",
      `${event.toolName.replace("mgba_", "")} ${formatActionDetails(formatToolOutput(event.toolName, output), options)} ${dim(options, shortId(event.toolCallId))}`
    );
  }

  return line(
    options,
    "green",
    resultIcon(event.toolName, output),
    `result ${event.toolName} ${dim(options, shortId(event.toolCallId))} · ${formatToolOutput(event.toolName, output)}`
  );
}

function formatToolOutput(toolName: string, output: unknown): string {
  if (isObject(output)) {
    if (toolName === "mgba_status") {
      const buttons = Array.isArray(output.activeButtons)
        ? output.activeButtons.join(", ") || "none"
        : "unknown";
      return [
        `frame ${formatMaybeNumber(output.frame)}`,
        [output.gameTitle, output.gameCode].filter(Boolean).join(" "),
        `buttons ${buttons}`,
      ]
        .filter(Boolean)
        .join(" · ");
    }

    if (toolName === "mgba_screenshot" && typeof output.path === "string") {
      return `saved ${output.path}`;
    }

    const summarized = summarizeKnownFields(output, [
      "ok",
      "tapped",
      "held",
      "released",
      "duration",
      "path",
      "response",
    ]);
    if (summarized) {
      return summarized;
    }
  }

  return formatValue(output);
}

function formatActionDetails(details: string, options: RenderOptions): string {
  return details.replace(
    ACTION_BUTTON_VALUE_PATTERN,
    (_match, prefix: string, value: string) =>
      `${prefix}${paint(options, "red", value)}`
  );
}

function summarizeKnownFields(
  output: JsonObject,
  keys: readonly string[]
): string | null {
  const parts = keys
    .filter((key) => key in output)
    .map((key) => `${key}=${formatValue(output[key])}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function unwrapToolOutput(output: unknown): unknown {
  if (
    isObject(output) &&
    output.type === "json" &&
    "value" in output &&
    Object.keys(output).every((key) => key === "type" || key === "value")
  ) {
    return output.value;
  }
  return output;
}

function toolIcon(toolName: string): string {
  if (toolName === "mgba_screenshot") {
    return "📸";
  }
  if (toolName === "mgba_status") {
    return "🎮";
  }
  return "🛠";
}

function resultIcon(toolName: string, output: unknown): string {
  if (isObject(output) && output.ok === false) {
    return "⚠";
  }
  return toolIcon(toolName) === "🛠" ? "✅" : toolIcon(toolName);
}

function isInjectedUserMessage(
  event: Extract<AgentEvent, { type: "user-message" }>
): boolean {
  return summarizeInjectedUserMessage(event.content) !== null;
}

function summarizeInjectedUserMessage(
  content: readonly Extract<
    AgentEvent,
    { type: "user-message" }
  >["content"][number][]
): string | null {
  const textPart = content.find((part) => part.type === "text");
  const hasImage = content.some((part) => part.type === "image");
  if (
    !(textPart && hasImage && textPart.text.includes("Current mGBA status:"))
  ) {
    return null;
  }

  return `turn prompt · ${extractFrameSummary(textPart.text)} · [status + screenshot + prompt] injected`;
}

function extractFrameSummary(text: string): string {
  const match = text.match(STATUS_FRAME_PATTERN);
  return `frame ${match?.[1] ?? "unknown"}`;
}

function isActionTool(toolName: string): boolean {
  return [
    "mgba_tap",
    "mgba_tap_many",
    "mgba_hold",
    "mgba_hold_many",
    "mgba_release",
  ].includes(toolName);
}

function formatText(text: string | readonly string[]): string {
  return typeof text === "string" ? text : text.join("\\n");
}

function formatContentParts(
  content: readonly Extract<
    AgentEvent,
    { type: "user-message" }
  >["content"][number][]
): string {
  return content
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (part.type === "image") {
        return `[image ${part.mediaType ?? "image"}]`;
      }
      return `[file ${part.filename ?? part.mediaType}]`;
    })
    .join(" | ");
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatValue(entry)).join(", ")}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([key]) => key !== "data");
    if (entries.length === 0) {
      return "{}";
    }
    return entries
      .map(([key, entry]) => `${key}=${formatValue(entry)}`)
      .join(" · ");
  }
  return JSON.stringify(value);
}

function formatMaybeNumber(value: unknown): string {
  if (value === null || value === undefined) {
    return "unknown";
  }
  return typeof value === "number" ? formatNumber(value) : formatValue(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function shortId(id: string): string {
  return `#${id.slice(0, 8)}`;
}

function line(
  options: RenderOptions,
  colorName: keyof typeof COLORS,
  icon: string,
  message: string
): string {
  return `${paint(options, colorName, icon)} ${message}`;
}

function dim(options: RenderOptions, value: string): string {
  return paint(options, "dim", value);
}

function paint(
  { color }: RenderOptions,
  colorName: keyof typeof COLORS,
  value: string
): string {
  if (!color) {
    return value;
  }
  return `${COLORS[colorName]}${value}${COLORS.reset}`;
}

function shouldUseColor(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
