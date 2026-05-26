import type { HarnessErrorCode } from "./types.js";

export type SafeErrorContext = Record<string, unknown>;

export interface SerializedHarnessError {
  name: "HarnessError";
  code: HarnessErrorCode;
  message: string;
  context?: SafeErrorContext;
  cause?: string;
}

interface HarnessErrorOptions {
  cause?: unknown;
  context?: SafeErrorContext;
}

const secretValuePattern = /authorization:\s*bearer\s+[^\s,}]+|sk-[A-Za-z0-9_-]+|\b[A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password)[A-Za-z0-9_-]*\b\s*[:=]\s*[^\s,}]+/gi;
const secretKeyPattern = /(api[_-]?key|token|secret|password|authorization)/i;

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly safeContext?: SafeErrorContext;

  constructor(code: HarnessErrorCode, message: string, options: HarnessErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "HarnessError";
    this.code = code;
    this.safeContext = options.context === undefined ? undefined : redactContext(options.context);
  }

  toJSON(): SerializedHarnessError {
    const serialized: SerializedHarnessError = {
      name: "HarnessError",
      code: this.code,
      message: redactString(this.message)
    };

    if (this.safeContext !== undefined) {
      serialized.context = this.safeContext;
    }

    const causeMessage = safeCauseMessage(this.cause);
    if (causeMessage !== undefined) {
      serialized.cause = causeMessage;
    }

    return serialized;
  }
}

function redactContext(context: SafeErrorContext): SafeErrorContext {
  return redactSecrets(context) as SafeErrorContext;
}

function safeCauseMessage(cause: unknown): string | undefined {
  if (cause === undefined) {
    return undefined;
  }

  if (cause instanceof Error) {
    return redactString(cause.message);
  }

  if (typeof cause === "string") {
    return redactString(cause);
  }

  return redactString(String(cause));
}

function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        secretKeyPattern.test(key) ? "[REDACTED]" : redactSecrets(entry)
      ])
    );
  }

  return value;
}

function redactString(value: string): string {
  return value.replace(secretValuePattern, "[REDACTED]");
}
