import { WebSocketServer, type WebSocket } from "ws";
import type http from "node:http";
import type { ServerEnvelope, ServerMessageType } from "./wsProtocol.js";
import { parseClientMessage } from "./wsProtocol.js";

const RING_BUFFER_SIZE = 200;

export interface DevViewerHubOptions {
  readonly runId: string;
  readonly onButtonPress?: (button: string, frames: number) => Promise<void>;
}

export class DevViewerHub {
  private readonly runId: string;
  private readonly wss: WebSocketServer;
  private readonly ring: string[] = [];
  private seq = 0;
  private readonly onButtonPress?: (button: string, frames: number) => Promise<void>;

  constructor(options: DevViewerHubOptions) {
    this.runId = options.runId;
    this.onButtonPress = options.onButtonPress;
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (ws) => this.handleConnection(ws));
  }

  attachToServer(server: http.Server): void {
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/ws") {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit("connection", ws, request);
        });
      } else {
        socket.destroy();
      }
    });
  }

  publish(type: ServerMessageType, payload: unknown): void {
    this.seq += 1;
    const envelope: ServerEnvelope = { type, seq: this.seq, runId: this.runId, payload };
    const message = JSON.stringify(envelope);

    if (this.ring.length >= RING_BUFFER_SIZE) {
      this.ring.shift();
    }
    this.ring.push(message);

    for (const client of this.wss.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  close(): void {
    for (const client of this.wss.clients) {
      client.close(1001, "server shutting down");
    }
    this.wss.close();
  }

  private handleConnection(ws: WebSocket): void {
    this.seq += 1;
    const hello: ServerEnvelope = {
      type: "hello",
      seq: this.seq,
      runId: this.runId,
      payload: { serverTime: new Date().toISOString() },
    };
    ws.send(JSON.stringify(hello));

    ws.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      const msg = parseClientMessage(raw);
      if (!msg) {
        return;
      }

      if (msg.type === "resume" && typeof msg.lastSeq === "number") {
        this.replayFrom(ws, msg.lastSeq);
        return;
      }

      if (msg.type === "input:press" && this.onButtonPress) {
        this.onButtonPress(msg.payload.button, msg.payload.frames)
          .then(() => {
            const ack: ServerEnvelope = { type: "ack", seq: this.seq, runId: this.runId, payload: { id: msg.id } };
            if (ws.readyState === 1) {
              ws.send(JSON.stringify(ack));
            }
          })
          .catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            const errEnvelope: ServerEnvelope = { type: "error", seq: this.seq, runId: this.runId, payload: { message: errMsg, id: msg.id } };
            if (ws.readyState === 1) {
              ws.send(JSON.stringify(errEnvelope));
            }
          });
      }
    });
  }

  private replayFrom(ws: WebSocket, lastSeq: number): void {
    for (const raw of this.ring) {
      try {
        const envelope = JSON.parse(raw) as ServerEnvelope;
        if (envelope.seq > lastSeq && ws.readyState === 1) {
          ws.send(raw);
        }
      } catch { /* empty */ }
    }
  }
}
