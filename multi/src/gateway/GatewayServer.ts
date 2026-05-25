// biome-ignore-all lint/style/useFilenamingConvention: Existing multi modules use PascalCase filenames.
import { createServer } from "node:http";

import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { WebSocketServer } from "ws";

import type { Config } from "../config.js";
import { DashboardBroadcast } from "../streaming/DashboardBroadcast.js";
import { FrameCapture } from "../streaming/FrameCapture.js";
import { StreamMetrics } from "../streaming/StreamMetrics.js";
import { createAdminRouter, type IInstanceManager } from "./AdminRouter.js";
import { createApiRouter, type InstanceRegistry } from "./ApiRouter.js";

export interface GatewayServer {
  httpServer: ReturnType<typeof createServer>;
  start(): void;
  stop(): Promise<void>;
  wss: WebSocketServer;
}

export function createGatewayServer(
  config: Config,
  registry: InstanceRegistry,
  instanceManager: IInstanceManager
): GatewayServer {
  const app = new Hono();

  app.use("*", logger());
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/", (c) =>
    c.html(
      "<html><body><h1>mGBA Gateway Dashboard</h1><p>Coming soon...</p></body></html>"
    )
  );

  const streamMetrics = new StreamMetrics();

  app.route(
    "/admin",
    createAdminRouter(config, registry, instanceManager, { streamMetrics })
  );
  app.route("/api/v1/:token", createApiRouter(registry));
  app.route("/", createApiRouter(registry, { fallbackToSingleInstance: true }));

  const httpServer = createServer(getRequestListener(app.fetch));
  const wss = new WebSocketServer({ server: httpServer });
  const frameCapture = new FrameCapture(
    registry,
    config.captureIntervalMs,
    config.sourceCaptureIntervalMs,
    config.streamKeyframeInterval,
    config.streamTileSize
  );
  const broadcast = new DashboardBroadcast(
    wss,
    registry,
    config.wsBackpressureLimit,
    streamMetrics,
    { requestKeyframe: (token) => frameCapture.forceKeyframe(token) }
  );
  frameCapture.onFrame((frame) => {
    streamMetrics.recordProduced(frame);
    broadcast.broadcastFrame(frame);
  });

  return {
    httpServer,
    wss,
    start() {
      frameCapture.start();
      httpServer.listen(config.port, () => {
        console.log(
          `Gateway server running on http://localhost:${config.port}`
        );
      });
    },
    stop() {
      frameCapture.stop();
      return new Promise<void>((resolve, reject) => {
        wss.close(() => {
          httpServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      });
    },
  };
}
