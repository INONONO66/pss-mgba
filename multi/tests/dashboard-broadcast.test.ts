import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import type { InstanceRegistry } from "../src/gateway/ApiRouter.js";
import { MgbaSocketClient } from "../src/mgba/MgbaSocketClient.js";
import {
  DashboardBroadcast,
  encodeFrame,
} from "../src/streaming/DashboardBroadcast.js";
import type { CapturedFrame } from "../src/streaming/FrameCapture.js";
import { decodeStreamFrame, StreamFrameType } from "../src/streaming/StreamProtocol.js";

const HOST = "127.0.0.1";
const TOKEN_A = "token-a";
const TOKEN_B = "token-b";

describe("DashboardBroadcast", () => {
  const fixtures: BroadcastFixture[] = [];

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  });

  it("encodes raw-tile stream frames with protocol metadata instead of JPEG bytes", () => {
    const encoded = encodeFrame(
      createFrame({ instanceIndex: 7, timestampMs: 0x12_34_56_78, sequence: 9 })
    );

    expect(encoded.subarray(0, 4).toString("ascii")).toBe("PSMG");
    expect(decodeStreamFrame(encoded)).toMatchObject({
      frameType: StreamFrameType.Keyframe,
      instanceIndex: 7,
      sequence: 9,
      timestampMs: 0x12_34_56_78,
      width: 240,
      height: 160,
      tileSize: 16,
    });
  });

  it("drops frames for clients over the backpressure limit", async () => {
    const fixture = await createFixture(8);
    fixtures.push(fixture);
    const overLimit = fixture.nextServerSocket();
    const client = await fixture.connect("/ws/dashboard");
    const serverSocket = await overLimit;
    Object.defineProperty(serverSocket, "bufferedAmount", {
      value: 9,
      configurable: true,
    });

    const messagePromise = nextMessage(client, 30);
    fixture.broadcast.broadcastFrame(createFrame());

    await expect(messagePromise).resolves.toBeUndefined();
  });

  it("replays latest keyframes to newly connected dashboard clients", async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);
    const keyframe = createFrame({ timestampMs: 1, sequence: 1 });
    const delta = createFrame({ frameType: StreamFrameType.Delta, timestampMs: 2, sequence: 2 });
    fixture.broadcast.broadcastFrame(keyframe);
    fixture.broadcast.broadcastFrame(delta);

    const client = new WebSocket(fixture.url("/ws/dashboard"));
    const firstMessage = nextMessage(client);
    await openClient(client);
    expect(await firstMessage).toEqual(encodeFrame(keyframe));
    await closeClient(client);
  });

  it("routes per-instance frames only to matching token subscribers", async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);
    const clientA = await fixture.connect(`/ws/instance/${TOKEN_A}`);
    const clientB = await fixture.connect(`/ws/instance/${TOKEN_B}`);

    const messageA = nextMessage(clientA);
    const messageB = nextMessage(clientB, 30);
    const frame = createFrame({
      token: TOKEN_A,
      instanceId: "instance-a",
      timestampMs: 9,
    });
    fixture.broadcast.broadcastFrame(frame);

    await expect(messageA).resolves.toEqual(encodeFrame(frame));
    await expect(messageB).resolves.toBeUndefined();
  });

  it("closes malformed instance tokens without throwing", async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);
    const client = new WebSocket(fixture.url("/ws/instance/%"));

    await expect(closeCode(client)).resolves.toBe(4000);
  });

  it("suppresses deltas after a dropped stateful frame until a keyframe is delivered", async () => {
    const fixture = await createFixture(8, vi.fn());
    fixtures.push(fixture);
    const serverSocketPromise = fixture.nextServerSocket();
    const client = await fixture.connect(`/ws/instance/${TOKEN_A}`);
    const serverSocket = await serverSocketPromise;
    Object.defineProperty(serverSocket, "bufferedAmount", { value: 9, configurable: true });

    fixture.broadcast.broadcastFrame(createFrame({ frameType: StreamFrameType.Delta, sequence: 2 }));
    await expect(nextMessage(client, 30)).resolves.toBeUndefined();

    Object.defineProperty(serverSocket, "bufferedAmount", { value: 0, configurable: true });
    fixture.broadcast.broadcastFrame(createFrame({ frameType: StreamFrameType.Delta, sequence: 3 }));
    await expect(nextMessage(client, 30)).resolves.toBeUndefined();

    const keyframe = createFrame({ sequence: 4 });
    const keyframeMessage = nextMessage(client);
    fixture.broadcast.broadcastFrame(keyframe);
    await expect(keyframeMessage).resolves.toEqual(encodeFrame(keyframe));

    const delta = createFrame({ frameType: StreamFrameType.Delta, sequence: 5 });
    const deltaMessage = nextMessage(client);
    fixture.broadcast.broadcastFrame(delta);
    await expect(deltaMessage).resolves.toEqual(encodeFrame(delta));
  });


  it("marks dropped cached keyframe replay for recovery before later deltas", async () => {
    const requestKeyframe = vi.fn();
    const fixture = await createFixture(-1, requestKeyframe);
    fixtures.push(fixture);
    const cached = createFrame({ sequence: 1 });
    fixture.broadcast.broadcastFrame(cached);

    const client = await fixture.connect(`/ws/instance/${TOKEN_A}`);

    await expect(nextMessage(client, 30)).resolves.toBeUndefined();
    expect(requestKeyframe).toHaveBeenCalledWith(TOKEN_A);

    const delta = createFrame({ frameType: StreamFrameType.Delta, sequence: 2 });
    fixture.broadcast.broadcastFrame(delta);
    await expect(nextMessage(client, 30)).resolves.toBeUndefined();
  });

  it("ignores oversized viewer controls before parsing", async () => {
    const requestKeyframe = vi.fn();
    const fixture = await createFixture(262_144, requestKeyframe);
    fixtures.push(fixture);
    fixture.broadcast.broadcastFrame(createFrame());
    const client = await fixture.connect(`/ws/instance/${TOKEN_A}`);
    await nextMessage(client);
    requestKeyframe.mockClear();

    client.send(Buffer.alloc(4097, "{"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(requestKeyframe).not.toHaveBeenCalled();
  });

  it("accepts throttled keyframe requests from per-instance viewers", async () => {
    const requestKeyframe = vi.fn();
    const fixture = await createFixture(262_144, requestKeyframe);
    fixtures.push(fixture);
    fixture.broadcast.broadcastFrame(createFrame());
    const client = await fixture.connect(`/ws/instance/${TOKEN_A}`);
    await nextMessage(client);
    requestKeyframe.mockClear();

    client.send(JSON.stringify({ type: "keyframe" }));
    await vi.waitFor(() => expect(requestKeyframe).toHaveBeenCalledWith(TOKEN_A));
  });
});

interface BroadcastFixture {
  broadcast: DashboardBroadcast;
  close(): Promise<void>;
  connect(path: string): Promise<WebSocket>;
  nextServerSocket(): Promise<WebSocket>;
  url(path: string): string;
}

async function createFixture(
  backpressureLimit = 262_144,
  requestKeyframe?: (token?: string) => void
): Promise<BroadcastFixture> {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  const registry = createRegistry();
  const broadcast = new DashboardBroadcast(wss, registry, backpressureLimit, undefined, { requestKeyframe });
  const port = await listen(httpServer);
  const clients = new Set<WebSocket>();

  return {
    broadcast,
    async close() {
      await Promise.all([...clients].map((client) => closeClient(client)));
      await closeWebSocketServer(wss);
      await closeHttpServer(httpServer);
    },
    async connect(path: string) {
      const client = new WebSocket(`ws://${HOST}:${port}${path}`);
      clients.add(client);
      client.on("close", () => clients.delete(client));
      await openClient(client);
      return client;
    },
    nextServerSocket() {
      return new Promise((resolve) => {
        wss.once("connection", (ws) => resolve(ws));
      });
    },
    url(path: string) {
      return `ws://${HOST}:${port}${path}`;
    },
  };
}

function createRegistry(): InstanceRegistry {
  return new Map([
    [TOKEN_A, createRegistryEntry(TOKEN_A, "instance-a")],
    [TOKEN_B, createRegistryEntry(TOKEN_B, "instance-b")],
  ]);
}

function createRegistryEntry(token: string, id: string) {
  return {
    info: {
      id,
      token,
      containerId: `container-${id}`,
      containerHost: "127.0.0.1",
      status: "running" as const,
      createdAt: new Date("2026-05-25T00:00:00Z"),
    },
    client: new MgbaSocketClient(),
  };
}

function createFrame(overrides: Partial<CapturedFrame> = {}): CapturedFrame {
  return {
    changedTiles: 0,
    frameType: StreamFrameType.Keyframe,
    height: 160,
    instanceIndex: 0,
    instanceId: "instance-a",
    payload: Buffer.from([1, 2, 3]),
    payloadBytes: 3,
    rawBytes: 240 * 160 * 4,
    sequence: 1,
    tileSize: 16,
    timestampMs: 123,
    token: TOKEN_A,
    width: 240,
    ...overrides,
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("HTTP server did not bind to a TCP port"));
        return;
      }

      resolve((address as AddressInfo).port);
    });
  });
}

function openClient(client: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once("error", reject);
    client.once("open", () => {
      client.off("error", reject);
      resolve();
    });
  });
}

function closeClient(client: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (client.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }

    client.once("close", () => resolve());
    client.close();
  });
}

function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    wss.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function nextMessage(
  client: WebSocket,
  timeoutMs = 250
): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, timeoutMs);

    const onMessage = (data: RawData) => {
      cleanup();
      resolve(rawDataToBuffer(data));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      client.off("message", onMessage);
      client.off("error", onError);
    };

    client.on("message", onMessage);
    client.on("error", onError);
  });
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

function closeCode(client: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    client.once("error", reject);
    client.once("close", (code) => {
      client.off("error", reject);
      resolve(code);
    });
  });
}
