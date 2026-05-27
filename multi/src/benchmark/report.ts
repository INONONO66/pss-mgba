interface DistributionSummary {
  average: number;
  count: number;
  max: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
}

interface InstanceBenchmarkReport {
  displayedFps: DistributionSummary;
  droppedOrLateFrameRatio: number;
  droppedOrLateFrames: number;
  durationMs: number;
  expectedFrames: number;
  failures: string[];
  frameIntervalMs: DistributionSummary;
  instanceId: string;
  lateFrameThresholdMs: number;
  pass: boolean;
  receivedFrames: number;
  streamHealth: {
    reconnects: number;
    keyframeRecoveries: number;
    serverProducedFrames?: number;
    serverProducedFps?: number;
    serverDroppedFrames?: number;
    sequenceGaps?: number;
  };
  token?: string;
}

export interface ResourceSampleReport {
  containers: Array<{
    id: string;
    name?: string;
    memoryBytes?: number;
    memoryLimitBytes?: number;
    cpuPercent?: number;
    error?: string;
  }>;
  error?: string;
  processes: Array<{
    pid: number;
    role: string;
    rssBytes?: number;
    error?: string;
  }>;
  sampledAtMs: number;
  totalCpuPercent?: number;
  totalMemoryBytes?: number;
}

interface BenchmarkTarget {
  durationMs: number;
  instances: number;
  maxDroppedOrLateRatio: number;
  maxTotalRamBytes: number;
  minP95Fps: number;
  requiresGatewayMemory?: boolean;
  strictAcceptance?: boolean;
}

interface BenchmarkReport {
  baseUrl: string;
  generatedAt: string;
  instances: InstanceBenchmarkReport[];
  measurementWindow?: {
    durationMs: number;
    endedAt: string;
    startedAt: string;
  };
  resources: {
    memoryCoverage: "complete" | "partial";
    samples: ResourceSampleReport[];
    peakTotalMemoryBytes?: number;
    averageTotalMemoryBytes?: number;
    peakTotalCpuPercent?: number;
    averageTotalCpuPercent?: number;
  };
  schemaVersion: "pss-mgba-headless-benchmark/v1";
  serverStreamMetrics?: unknown;
  target: BenchmarkTarget;
  verdict: {
    pass: boolean;
    failures: string[];
  };
}

export function summarize(values: number[]): DistributionSummary {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, average: 0, p50: 0, p95: 0, p99: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    average: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

export function buildInstanceReport(opts: {
  instanceId: string;
  token?: string;
  receivedAtMs: number[];
  durationMs: number;
  windowEndedAtMs?: number;
  windowStartedAtMs?: number;
  lateFrameThresholdMs: number;
  minP95Fps: number;
  maxDroppedOrLateRatio: number;
  serverProducedFrames?: number;
  serverProducedFps?: number;
  serverDroppedFrames?: number;
  reconnects?: number;
  keyframeRecoveries?: number;
  sequenceGaps?: number;
}): InstanceBenchmarkReport {
  const measuredDurationMs =
    opts.windowStartedAtMs !== undefined && opts.windowEndedAtMs !== undefined
      ? Math.max(0, opts.windowEndedAtMs - opts.windowStartedAtMs)
      : opts.durationMs;
  const intervals = deltasWithWindowBoundaries(
    opts.receivedAtMs,
    opts.windowStartedAtMs,
    opts.windowEndedAtMs
  );
  const fpsSamples = intervals.map((intervalMs) =>
    intervalMs > 0 ? 1000 / intervalMs : 0
  );
  const frameBudgetMs = 1000 / opts.minP95Fps;
  const lateFrameEquivalents = intervals.reduce(
    (total, intervalMs) =>
      total + countLateFrameEquivalents(intervalMs, frameBudgetMs, opts.lateFrameThresholdMs),
    0
  );
  const expectedFrames = Math.max(
    1,
    Math.floor((measuredDurationMs * opts.minP95Fps) / 1000)
  );
  const missingFrames = Math.max(0, expectedFrames - opts.receivedAtMs.length);
  const protocolDroppedFrames = Math.max(opts.serverDroppedFrames ?? 0, opts.sequenceGaps ?? 0);
  const droppedOrLateFrames = Math.max(lateFrameEquivalents, missingFrames, protocolDroppedFrames);
  const droppedOrLateFrameRatio = droppedOrLateFrames / expectedFrames;
  const displayedFps = summarize(fpsSamples);
  const frameIntervalMs = summarize(intervals);
  const failures: string[] = [];

  const maxSustainedFrameIntervalMs = frameBudgetMs;
  if (frameIntervalMs.p95 - maxSustainedFrameIntervalMs > 1e-6) {
    const sustainedP95Fps =
      frameIntervalMs.p95 > 0 ? 1000 / frameIntervalMs.p95 : 0;
    failures.push(
      `sustained p95 FPS ${formatNumber(sustainedP95Fps)} < ${opts.minP95Fps} (frame interval p95 ${formatNumber(frameIntervalMs.p95)}ms > ${formatNumber(maxSustainedFrameIntervalMs)}ms)`
    );
  }

  if (droppedOrLateFrameRatio > opts.maxDroppedOrLateRatio) {
    failures.push(
      `dropped/late ratio ${formatNumber(droppedOrLateFrameRatio)} > ${opts.maxDroppedOrLateRatio}`
    );
  }

  if (opts.receivedAtMs.length === 0) {
    failures.push("no frames received");
  }

  return {
    instanceId: opts.instanceId,
    token: opts.token,
    receivedFrames: opts.receivedAtMs.length,
    expectedFrames,
    displayedFps,
    frameIntervalMs,
    droppedOrLateFrames,
    droppedOrLateFrameRatio,
    lateFrameThresholdMs: opts.lateFrameThresholdMs,
    durationMs: measuredDurationMs,
    streamHealth: {
      reconnects: opts.reconnects ?? 0,
      keyframeRecoveries: opts.keyframeRecoveries ?? 0,
      serverProducedFrames: opts.serverProducedFrames,
      serverProducedFps: opts.serverProducedFps,
      serverDroppedFrames: opts.serverDroppedFrames,
      sequenceGaps: opts.sequenceGaps,
    },
    pass: failures.length === 0,
    failures,
  };
}

export function finalizeBenchmarkReport(opts: {
  generatedAt?: Date;
  baseUrl: string;
  measurementWindow?: { startedAt: Date; endedAt: Date };
  target: BenchmarkTarget;
  instances: InstanceBenchmarkReport[];
  resourceSamples: ResourceSampleReport[];
  serverStreamMetrics?: unknown;
}): BenchmarkReport {
  const memorySamples = opts.resourceSamples
    .map((sample) => sample.totalMemoryBytes)
    .filter((value): value is number => value !== undefined);
  const cpuSamples = opts.resourceSamples
    .map((sample) => sample.totalCpuPercent)
    .filter((value): value is number => value !== undefined);
  const failures = opts.instances.flatMap((instance) =>
    instance.failures.map((failure) => `${instance.instanceId}: ${failure}`)
  );
  const strictAcceptance = opts.target.strictAcceptance ?? true;
  const requiresGatewayMemory =
    opts.target.requiresGatewayMemory ?? strictAcceptance;
  const resourceFailures = collectResourceFailures(
    opts.resourceSamples,
    requiresGatewayMemory
  );
  failures.push(...resourceFailures);

  if (strictAcceptance && opts.target.instances !== 10) {
    failures.push(`strict benchmark requires exactly 10 instances, got ${opts.target.instances}`);
  }

  if (strictAcceptance && opts.target.durationMs < 60_000) {
    failures.push(
      `strict benchmark requires duration >= 60000ms, got ${opts.target.durationMs}ms`
    );
  }

  if (strictAcceptance && opts.target.minP95Fps < 60) {
    failures.push(
      `strict benchmark requires min p95 FPS >= 60, got ${opts.target.minP95Fps}`
    );
  }

  if (strictAcceptance && opts.target.maxDroppedOrLateRatio > 0.01) {
    failures.push(
      `strict benchmark requires dropped/late ratio <= 0.01, got ${opts.target.maxDroppedOrLateRatio}`
    );
  }

  if (
    strictAcceptance &&
    opts.target.maxTotalRamBytes > 16 * 1024 * 1024 * 1024
  ) {
    failures.push(
      `strict benchmark requires RAM limit <= 17179869184 bytes, got ${opts.target.maxTotalRamBytes} bytes`
    );
  }

  if (strictAcceptance && !hasServerMetricDelta(opts.serverStreamMetrics)) {
    failures.push("strict benchmark requires benchmark-window stream metric delta");
  }

  if (opts.instances.length !== opts.target.instances) {
    failures.push(
      `instance count ${opts.instances.length} != ${opts.target.instances}`
    );
  }

  const peakTotalMemoryBytes =
    memorySamples.length > 0 ? Math.max(...memorySamples) : undefined;
  if (
    peakTotalMemoryBytes !== undefined &&
    peakTotalMemoryBytes > opts.target.maxTotalRamBytes
  ) {
    failures.push(
      `peak RAM ${peakTotalMemoryBytes} bytes > ${opts.target.maxTotalRamBytes} bytes`
    );
  }

  if (memorySamples.length === 0) {
    failures.push("RAM samples unavailable");
  }

  return {
    schemaVersion: "pss-mgba-headless-benchmark/v1",
    generatedAt: (opts.generatedAt ?? new Date()).toISOString(),
    baseUrl: opts.baseUrl,
    target: opts.target,
    measurementWindow:
      opts.measurementWindow === undefined
        ? undefined
        : {
            startedAt: opts.measurementWindow.startedAt.toISOString(),
            endedAt: opts.measurementWindow.endedAt.toISOString(),
            durationMs:
              opts.measurementWindow.endedAt.getTime() -
              opts.measurementWindow.startedAt.getTime(),
          },
    instances: opts.instances,
    resources: {
      memoryCoverage: resourceFailures.length === 0 ? "complete" : "partial",
      samples: opts.resourceSamples,
      peakTotalMemoryBytes,
      averageTotalMemoryBytes:
        memorySamples.length > 0 ? average(memorySamples) : undefined,
      peakTotalCpuPercent:
        cpuSamples.length > 0 ? Math.max(...cpuSamples) : undefined,
      averageTotalCpuPercent:
        cpuSamples.length > 0 ? average(cpuSamples) : undefined,
    },
    serverStreamMetrics: opts.serverStreamMetrics,
    verdict: {
      pass: failures.length === 0,
      failures,
    },
  };
}

export function formatHumanSummary(report: BenchmarkReport): string {
  const lines = [
    `Headless mGBA benchmark: ${report.verdict.pass ? "PASS" : "FAIL"}`,
    `Target: ${report.target.instances} instances, ${report.target.durationMs}ms, p95 FPS >= ${report.target.minP95Fps}, dropped/late <= ${report.target.maxDroppedOrLateRatio * 100}%`,
  ];

  for (const instance of report.instances) {
    lines.push(
      `${instance.pass ? "PASS" : "FAIL"} ${instance.instanceId}: fps_p95=${formatNumber(instance.displayedFps.p95)}fps interval_p95=${formatNumber(instance.frameIntervalMs.p95)}ms avg=${formatNumber(instance.displayedFps.average)}fps late=${instance.droppedOrLateFrames}/${instance.expectedFrames} ratio=${formatNumber(instance.droppedOrLateFrameRatio)}`
    );
  }

  if (report.resources.peakTotalMemoryBytes === undefined) {
    lines.push("Peak RAM: unavailable");
  } else {
    lines.push(
      `Peak RAM: ${formatBytes(report.resources.peakTotalMemoryBytes)}`
    );
  }

  if (!report.verdict.pass) {
    lines.push("Failures:");
    for (const failure of report.verdict.failures) {
      lines.push(`- ${failure}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function deltasWithWindowBoundaries(
  values: number[],
  windowStartedAtMs: number | undefined,
  windowEndedAtMs: number | undefined
): number[] {
  const result: number[] = [];
  if (values.length > 0 && windowStartedAtMs !== undefined) {
    result.push(Math.max(0, (values[0] ?? windowStartedAtMs) - windowStartedAtMs));
  }
  for (let index = 1; index < values.length; index += 1) {
    const current = values[index];
    const previous = values[index - 1];
    if (current !== undefined && previous !== undefined) {
      result.push(current - previous);
    }
  }
  if (values.length > 0 && windowEndedAtMs !== undefined) {
    result.push(Math.max(0, windowEndedAtMs - (values.at(-1) ?? windowEndedAtMs)));
  }
  return result;
}

function countLateFrameEquivalents(
  intervalMs: number,
  frameBudgetMs: number,
  lateFrameThresholdMs: number
): number {
  if (intervalMs <= lateFrameThresholdMs) {
    return 0;
  }

  return Math.max(1, Math.floor(intervalMs / frameBudgetMs) - 1);
}

function collectResourceFailures(
  samples: ResourceSampleReport[],
  requiresGatewayMemory: boolean
): string[] {
  const failures: string[] = [];
  for (const [sampleIndex, sample] of samples.entries()) {
    if (sample.error) {
      failures.push(`resource sample ${sampleIndex}: ${sample.error}`);
    }

    for (const container of sample.containers) {
      if (container.error) {
        failures.push(`resource sample ${sampleIndex}: container ${container.id} ${container.error}`);
        continue;
      }
      if (container.memoryBytes === undefined) {
        failures.push(`resource sample ${sampleIndex}: container ${container.id} memory unavailable`);
      }
    }

    const gatewayProcesses = sample.processes.filter(
      (process) => process.role === "gateway"
    );
    if (requiresGatewayMemory && gatewayProcesses.length === 0) {
      failures.push(`resource sample ${sampleIndex}: gateway RSS unavailable`);
    }

    for (const process of gatewayProcesses) {
      if (process.error) {
        failures.push(`resource sample ${sampleIndex}: ${process.role} pid ${process.pid} ${process.error}`);
        continue;
      }
      if (process.rssBytes === undefined) {
        failures.push(`resource sample ${sampleIndex}: ${process.role} pid ${process.pid} RSS unavailable`);
      }
    }
  }

  return failures;
}

function hasServerMetricDelta(serverStreamMetrics: unknown): boolean {
  if (
    !serverStreamMetrics ||
    typeof serverStreamMetrics !== "object" ||
    !("delta" in serverStreamMetrics)
  ) {
    return false;
  }

  const delta = (serverStreamMetrics as { delta?: unknown }).delta;
  return (
    !!delta &&
    typeof delta === "object" &&
    Array.isArray((delta as { instances?: unknown }).instances)
  );
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.ceil(percentileValue * sortedValues.length) - 1;
  return (
    sortedValues[Math.min(Math.max(index, 0), sortedValues.length - 1)] ?? 0
  );
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function formatBytes(bytes: number): string {
  const gib = bytes / 1024 / 1024 / 1024;
  return `${gib.toFixed(2)} GiB`;
}
