import type { AgentEvent } from "@minpeter/pss-runtime";
import type { RunTrace } from "./run-trace";
import type { TokenUsageMetric } from "./token-usage";

export interface PrettyLoggerOptions {
  color?: boolean;
  write?: (line: string) => void;
}

interface RenderOptions {
  color: boolean;
}

type JsonObject = Record<string, unknown>;

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
  runTrace: (trace: RunTrace) => void;
  tokenUsage: (metric: TokenUsageMetric) => void;
} {
  const options = { color } satisfies RenderOptions;

  return {
    event: (event) => write(renderAgentEvent(event, options)),
    runTrace: (trace) => write(renderRunTrace(trace, options)),
    tokenUsage: (metric) => write(renderTokenUsageMetric(metric, options)),
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
      return line(
        options,
        "blue",
        "👤",
        `user · ${formatContentParts(event.content)}`
      );
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

function renderToolCall(
  event: Extract<AgentEvent, { type: "tool-call" }>,
  options: RenderOptions
): string {
  return line(
    options,
    "blue",
    toolIcon(event.toolName),
    `call ${event.toolName} ${dim(options, shortId(event.toolCallId))} · ${formatValue(event.input)}`
  );
}

function renderToolResult(
  event: Extract<AgentEvent, { type: "tool-result" }>,
  options: RenderOptions
): string {
  const output = unwrapToolOutput(event.output);
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
