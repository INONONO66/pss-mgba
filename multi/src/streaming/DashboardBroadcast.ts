// biome-ignore-all lint/style/useFilenamingConvention: Existing multi modules use PascalCase filenames.
import type { IncomingMessage } from "node:http";

import type { WebSocket, WebSocketServer } from "ws";

import type { InstanceRegistry } from "../gateway/ApiRouter.js";
import type { CapturedFrame } from "./FrameCapture.js";
import {
  encodeStreamFrame,
  parseStreamClientControl,
  STREAM_FRAME_DELTA,
  STREAM_FRAME_KEYFRAME,
} from "./StreamProtocol.js";
import type { StreamMetrics } from "./StreamMetrics.js";

const OPEN_READY_STATE = 1;

export class DashboardBroadcast {
  private readonly dashboardClients = new Set<WebSocket>();
  private readonly instanceClients = new Map<string, Set<WebSocket>>();
  private readonly latestKeyframes = new Map<string, Buffer>();
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
    if (frame.isKeyframe) {
      this.latestKeyframes.set(frame.instanceId, binary);
    }

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
      this.attachClientControl(ws);
      setImmediate(() => this.replayLatestKeyframes(ws));
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
      this.attachClientControl(ws, token);
      setImmediate(() => this.replayLatestKeyframe(ws, token));
      ws.on("close", () => clients.delete(ws));
      ws.on("error", () => clients.delete(ws));
      return;
    }

    ws.close(4000, "Unknown endpoint");
  }

  private attachClientControl(ws: WebSocket, token?: string): void {
    ws.on("message", (data) => {
      if (typeof data !== "string" && !Buffer.isBuffer(data)) {
        return;
      }

      const text = Buffer.isBuffer(data) ? data.toString("utf8") : data;
      const message = parseStreamClientControl(text);
      if (!message) {
        return;
      }

      if (message.type === "keyframe") {
        const requestedToken = token ?? tokenForInstanceId(this.registry, message.instanceId);
        if (requestedToken) {
          this.replayLatestKeyframe(ws, requestedToken);
        } else {
          this.replayLatestKeyframes(ws);
        }
        return;
      }

      const instanceId = token === undefined
        ? message.instanceId
        : this.registry.get(token)?.info.id;
      this.metrics?.recordClientMetrics({ ...message, instanceId });
    });
  }

  private replayLatestKeyframes(ws: WebSocket): void {
    for (const binary of this.latestKeyframes.values()) {
      sendWithBackpressure(ws, binary, this.backpressureLimit);
    }
  }

  private replayLatestKeyframe(ws: WebSocket, token: string): void {
    const entry = this.registry.get(token);
    if (!entry) {
      return;
    }

    const binary = this.latestKeyframes.get(entry.info.id);
    if (binary) {
      sendWithBackpressure(ws, binary, this.backpressureLimit);
    }
  }
}

export function encodeFrame(frame: CapturedFrame): Buffer {
  return encodeStreamFrame({
    frameType: frame.isKeyframe ? STREAM_FRAME_KEYFRAME : STREAM_FRAME_DELTA,
    instanceIndex: frame.instanceIndex,
    payload: frame.jpegBuffer,
    sequence: frame.sequence,
    timestampMs: frame.timestampMs,
  });
}

function tokenForInstanceId(
  registry: InstanceRegistry,
  instanceId: string | undefined
): string | undefined {
  if (!instanceId) {
    return;
  }

  for (const [token, entry] of registry.entries()) {
    if (entry.info.id === instanceId) {
      return token;
    }
  }

  return;
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
