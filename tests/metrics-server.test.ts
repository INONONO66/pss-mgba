import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startMetricsServer } from "../src/metrics-server";
import type { RunMetricsTracker } from "../src/run-metrics";
import type { TokenUsageTracker } from "../src/token-usage";

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
  vi.restoreAllMocks();
});

describe("startMetricsServer", () => {
  it("serves health checks when the port is free", async () => {
    const server = startMetricsServer(tokenTracker(), runMetrics(), {
      host: "127.0.0.1",
      port: 0,
    });
    openServers.push(server);
    await once(server, "listening");

    const address = server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("expected TCP server address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("logs and continues when the metrics port is already occupied", async () => {
    const blocker = createServer((_request, response) => response.end("busy"));
    openServers.push(blocker);
    blocker.listen(0, "127.0.0.1");
    await once(blocker, "listening");
    const address = blocker.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("expected TCP blocker address");
    }
    const consoleDir = vi.spyOn(console, "dir").mockImplementation(() => {
      return;
    });

    const server = startMetricsServer(tokenTracker(), runMetrics(), {
      host: "127.0.0.1",
      port: address.port,
    });
    openServers.push(server);
    await closed(server);

    expect(consoleDir).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "EADDRINUSE",
        port: address.port,
        type: "metrics-server-unavailable",
      })
    );
  });
});

function tokenTracker(): TokenUsageTracker {
  return {
    prometheusMetrics: () => "token_metric 1\n",
  } as TokenUsageTracker;
}

function runMetrics(): RunMetricsTracker {
  return {
    prometheusMetrics: () => "run_metric 1\n",
  } as RunMetricsTracker;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function once(server: Server, event: "close" | "listening"): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once(event, () => resolve());
    server.once("error", reject);
  });
}

function closed(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.once("close", () => resolve());
  });
}
