import { createServer, type ServerResponse } from "node:http";
import { readRunSummaries, renderRunSummaryPrometheus } from "./run-summary";
import type { TokenUsageTracker } from "./token-usage";

export interface MetricsServerOptions {
  host: string;
  port: number;
}

export function startMetricsServer(
  tracker: TokenUsageTracker,
  { host, port }: MetricsServerOptions
): void {
  const server = createServer((request, response) => {
    if (request.url === "/metrics") {
      writeMetricsResponse(tracker, response).catch((error: unknown) => {
        response.writeHead(500, { "content-type": "text/plain" });
        response.end(
          `${error instanceof Error ? error.message : String(error)}\n`
        );
      });
      return;
    }

    if (request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found\n");
  });

  server.listen(port, host, () => {
    console.dir({
      type: "metrics-server",
      url: `http://${host}:${port}/metrics`,
    });
  });
}

async function writeMetricsResponse(
  tracker: TokenUsageTracker,
  response: ServerResponse
): Promise<void> {
  try {
    const summaries = await readRunSummaries();
    response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    response.end(
      [tracker.prometheusMetrics(), renderRunSummaryPrometheus(summaries)]
        .filter(Boolean)
        .join("\n")
    );
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end(`${error instanceof Error ? error.message : String(error)}\n`);
  }
}
