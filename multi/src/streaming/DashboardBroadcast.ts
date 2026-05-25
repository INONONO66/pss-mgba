// biome-ignore-all lint/style/useFilenamingConvention: Existing multi modules use PascalCase filenames.
import type { IncomingMessage } from "node:http";

import type { WebSocket, WebSocketServer } from "ws";

import type { InstanceRegistry } from "../gateway/ApiRouter.js";
import type { CapturedFrame } from "./FrameCapture.js";
import type { StreamMetrics } from "./StreamMetrics.js";

const OPEN_READY_STATE = 1;

export class DashboardBroadcast {
  private readonly dashboardClients = new Set<WebSocket>();
  private readonly instanceClients = new Map<string, Set<WebSocket>>();
  private readonly wss: WebSocketServer;
  private readonly registry: InstanceRegistry;
  private readonly backpressureLimit: number;
  private readonly metrics?: StreamMetrics;

  constructor(
    wss: WebSocketServer,
    registry: InstanceRegistry,
    backpressureLimit: number,
    metrics?: StreamMetrics
  ) {
    this.wss = wss;
    this.registry = registry;
    this.backpressureLimit = backpressureLimit;
    this.metrics = metrics;
    this.setupWebSocketServer();
  }

  broadcastFrame(frame: CapturedFrame): void {
    const binary = encodeFrame(frame);

    for (const ws of this.dashboardClients) {
      const delivered = sendWithBackpressure(
        ws,
        binary,
        this.backpressureLimit
      );
      this.metrics?.recordDelivery(frame, "dashboard", delivered);
    }

    const instanceSubscribers = this.instanceClients.get(frame.token);
    if (!instanceSubscribers) {
      return;
    }

    for (const ws of instanceSubscribers) {
      const delivered = sendWithBackpressure(
        ws,
        binary,
        this.backpressureLimit
      );
      this.metrics?.recordDelivery(frame, "instance", delivered);
    }
  }

  private setupWebSocketServer(): void {
    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req);
    });
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = req.url ?? "";

    if (url.startsWith("/ws/dashboard")) {
      this.dashboardClients.add(ws);
      ws.on("close", () => this.dashboardClients.delete(ws));
      ws.on("error", () => this.dashboardClients.delete(ws));
      return;
    }

    if (url.startsWith("/ws/instance/")) {
      const token = url.slice("/ws/instance/".length);
      if (!this.registry.has(token)) {
        ws.close(4001, "Unknown token");
        return;
      }

      let clients = this.instanceClients.get(token);
      if (!clients) {
        clients = new Set<WebSocket>();
        this.instanceClients.set(token, clients);
      }

      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
      ws.on("error", () => clients.delete(ws));
      return;
    }

    ws.close(4000, "Unknown endpoint");
  }
}

export function encodeFrame(frame: CapturedFrame): Buffer {
  const header = Buffer.allocUnsafe(5);
  header.writeUInt8(frame.instanceIndex % 256, 0);
  header.writeUInt32LE(frame.timestampMs % 4_294_967_296, 1);
  return Buffer.concat([header, frame.jpegBuffer]);
}

function sendWithBackpressure(
  ws: WebSocket,
  data: Buffer,
  limit: number
): boolean {
  if (ws.readyState !== OPEN_READY_STATE) {
    return false;
  }

  if (ws.bufferedAmount > limit) {
    return false;
  }

  ws.send(data, { binary: true }, () => undefined);
  return true;
}
