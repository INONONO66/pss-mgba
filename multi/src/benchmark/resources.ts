import { execFile } from "node:child_process";

import Dockerode from "dockerode";

import type { ResourceSampleReport } from "./report.js";

const LEADING_SLASH = /^\//;

interface ResourceSampleOptions {
  containerIds: string[];
  gatewayPid?: number;
}

export async function collectResourceSample(
  opts: ResourceSampleOptions
): Promise<ResourceSampleReport> {
  const containers = await Promise.all(
    opts.containerIds.map((containerId) => collectContainerStats(containerId))
  );
  const processes =
    opts.gatewayPid === undefined
      ? []
      : [await collectProcessRss(opts.gatewayPid, "gateway")];
  const containerMemory = containers
    .map((container) => container.memoryBytes)
    .filter((value): value is number => value !== undefined);
  const processMemory = processes
    .map((process) => process.rssBytes)
    .filter((value): value is number => value !== undefined);
  const cpuSamples = containers
    .map((container) => container.cpuPercent)
    .filter((value): value is number => value !== undefined);

  return {
    sampledAtMs: Date.now(),
    totalMemoryBytes:
      containerMemory.length + processMemory.length > 0
        ? [...containerMemory, ...processMemory].reduce(
            (sum, value) => sum + value,
            0
          )
        : undefined,
    totalCpuPercent:
      cpuSamples.length > 0
        ? cpuSamples.reduce((sum, value) => sum + value, 0)
        : undefined,
    containers,
    processes,
  };
}

async function collectContainerStats(
  containerId: string
): Promise<ResourceSampleReport["containers"][number]> {
  try {
    const docker = new Dockerode();
    const container = docker.getContainer(containerId);
    const [inspection, stats] = await Promise.all([
      container.inspect(),
      container.stats({ stream: false }) as Promise<Dockerode.ContainerStats>,
    ]);

    return {
      id: containerId,
      name: inspection.Name?.replace(LEADING_SLASH, ""),
      memoryBytes: calculateMemoryBytes(stats),
      memoryLimitBytes: stats.memory_stats?.limit,
      cpuPercent: calculateCpuPercent(stats),
    };
  } catch (error) {
    return {
      id: containerId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function collectProcessRss(
  pid: number,
  role: string
): Promise<ResourceSampleReport["processes"][number]> {
  try {
    const stdout = await execFileText("ps", ["-o", "rss=", "-p", String(pid)]);
    const rssKiB = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(rssKiB)) {
      throw new Error(`Unable to parse RSS from ps output: ${stdout}`);
    }

    return { pid, role, rssBytes: rssKiB * 1024 };
  } catch (error) {
    return {
      pid,
      role,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function calculateMemoryBytes(
  stats: Dockerode.ContainerStats
): number | undefined {
  const usage = stats.memory_stats?.usage;
  if (usage === undefined) {
    return;
  }

  const cache = stats.memory_stats?.stats?.cache ?? 0;
  return Math.max(0, usage - cache);
}

function calculateCpuPercent(
  stats: Dockerode.ContainerStats
): number | undefined {
  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const onlineCpus =
    stats.cpu_stats.online_cpus ??
    stats.cpu_stats.cpu_usage.percpu_usage?.length ??
    1;

  if (cpuDelta <= 0 || systemDelta <= 0) {
    return;
  }

  return (cpuDelta / systemDelta) * onlineCpus * 100;
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stdout);
    });
  });
}
