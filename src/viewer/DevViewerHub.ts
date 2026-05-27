import { WebSocketServer, type WebSocket } from "ws";
import type http from "node:http";
import type { AgentRunMode, ServerEnvelope, ServerMessageType } from "./wsProtocol.js";
import { parseClientMessage } from "./wsProtocol.js";

const RING_BUFFER_SIZE = 200;

export interface AgentController {
  start(mode: AgentRunMode, options?: { maxTurns?: number; loadSlot?: number }): void;
  stop(): void;
  getStatus(): { status: string; runId: string | undefined };
}

interface DevViewerHubOptions {
  readonly runId: string;
  readonly onButtonPress?: (button: string, frames: number) => Promise<void>;
  readonly agentController?: AgentController;
}

export class DevViewerHub {
  private readonly runId: string;
  private readonly wss: WebSocketServer;
  private readonly ring: string[] = [];
  private seq = 0;
  private readonly onButtonPress?: (button: string, frames: number) => Promise<void>;
  private readonly agentController?: AgentController;

  constructor(options: DevViewerHubOptions) {
    this.runId = options.runId;
    this.onButtonPress = options.onButtonPress;
    this.agentController = options.agentController;
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
        this.handleInputPress(ws, msg);
        return;
      }

      if (msg.type === "agent:start") {
        this.handleAgentStart(ws, msg);
        return;
      }

      if (msg.type === "agent:stop") {
        this.handleAgentStop(ws, msg);
        return;
      }

      if (msg.type === "agent:status-request") {
        this.handleAgentStatusRequest(ws, msg);
      }
    });
  }

  private handleInputPress(ws: WebSocket, msg: Extract<ReturnType<typeof parseClientMessage>, { type: "input:press" }>): void {
    if (!this.onButtonPress) {
      return;
    }
    this.onButtonPress(msg.payload.button, msg.payload.frames)
      .then(() => {
        this.sendAck(ws, msg.id);
      })
      .catch((err: unknown) => {
        this.sendError(ws, msg.id, err instanceof Error ? err.message : String(err));
      });
  }

  private handleAgentStart(ws: WebSocket, msg: Extract<ReturnType<typeof parseClientMessage>, { type: "agent:start" }>): void {
    if (!this.agentController) {
      this.sendError(ws, msg.id, "Agent controller not available");
      return;
    }
    this.agentController.start(msg.payload.mode, {
      maxTurns: msg.payload.maxTurns,
      loadSlot: msg.payload.loadSlot,
    });
    const status = this.agentController.getStatus();
    this.publish("agent:status", status);
    this.sendAck(ws, msg.id);
  }

  private handleAgentStop(ws: WebSocket, msg: { id: string }): void {
    if (!this.agentController) {
      this.sendError(ws, msg.id, "Agent controller not available");
      return;
    }
    this.agentController.stop();
    const status = this.agentController.getStatus();
    this.publish("agent:status", status);
    this.sendAck(ws, msg.id);
  }

  private handleAgentStatusRequest(ws: WebSocket, msg: { id: string }): void {
    const status = this.agentController?.getStatus() ?? { status: "standby", runId: undefined };
    const envelope: ServerEnvelope = {
      type: "agent:status",
      seq: this.seq,
      runId: this.runId,
      payload: { ...status, id: msg.id },
    };
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(envelope));
    }
  }

  private sendAck(ws: WebSocket, id: string): void {
    const ack: ServerEnvelope = { type: "ack", seq: this.seq, runId: this.runId, payload: { id } };
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(ack));
    }
  }

  private sendError(ws: WebSocket, id: string, message: string): void {
    const envelope: ServerEnvelope = { type: "error", seq: this.seq, runId: this.runId, payload: { message, id } };
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(envelope));
    }
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
