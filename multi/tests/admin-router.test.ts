import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { Config } from "../src/config.js";
import {
  createAdminRouter,
  type IInstanceManager,
} from "../src/gateway/AdminRouter.js";
import type { InstanceRegistry } from "../src/gateway/ApiRouter.js";
import type { InstanceInfo } from "../src/instances/types.js";
import { StreamMetrics } from "../src/streaming/StreamMetrics.js";
import type { CapturedFrame } from "../src/streaming/FrameCapture.js";
import { StreamFrameType } from "../src/streaming/StreamProtocol.js";
import { MgbaSocketClient } from "../src/mgba/MgbaSocketClient.js";

describe("createAdminRouter", () => {
  it("requires the admin token", async () => {
    const fixture = createFixture();

    const response = await fixture.app.request("/admin/instances");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("exposes live stream metrics for benchmark collection", async () => {
    const fixture = createFixture();
    const frame = createFrame();
    fixture.streamMetrics.recordProduced(frame);
    fixture.streamMetrics.recordProduced({ ...frame, timestampMs: 2000 });
    fixture.streamMetrics.recordDelivery(frame, "dashboard", true);
    fixture.streamMetrics.recordDelivery(frame, "instance", false);

    const response = await fixture.app.request("/admin/metrics/streams", {
      headers: { "X-Admin-Token": "admin-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      aggregate: {
        producedFrames: 2,
        dashboardFramesSent: 1,
        instanceFramesDropped: 1,
      },
      instances: [
        {
          instanceId: "instance-a",
          producedFrames: 2,
          dashboardFramesSent: 1,
          instanceFramesDropped: 1,
        },
      ],
    });
  });

  it("returns 503 instead of creating beyond maxInstances", async () => {
    const instance = createInstanceInfo("instance-a");
    const fixture = createFixture({ instances: [instance], maxInstances: 1 });

    const response = await fixture.app.request("/admin/instances", {
      method: "POST",
      headers: { "X-Admin-Token": "admin-token" },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Max instances reached" });
    expect(fixture.instanceManager.create).not.toHaveBeenCalled();
  });
});

interface FixtureOptions {
  instances?: InstanceInfo[];
  maxInstances?: number;
}

function createFixture(options: FixtureOptions = {}) {
  const instances = [...(options.instances ?? [])];
  const instanceManager: IInstanceManager = {
    create: vi.fn(async () => createInstanceInfo("created-instance")),
    destroy: vi.fn(async () => undefined),
    list: vi.fn(() => instances),
    get: vi.fn((id: string) =>
      instances.find((instance) => instance.id === id)
    ),
  };
  const streamMetrics = new StreamMetrics();
  const registry: InstanceRegistry = new Map(
    options.instances?.map((instance) => [
      instance.token,
      { info: instance, client: new MgbaSocketClient() },
    ]) ?? []
  );
  const app = new Hono();
  app.route(
    "/admin",
    createAdminRouter(
      {
        port: 8787,
        adminToken: "admin-token",
        maxInstances: options.maxInstances ?? 10,
        emulatorImage: "pss-mgba-emulator",
        emulatorPort: 8888,
        emulatorMemoryBytes: 805_306_368,
        captureIntervalMs: 16,
        captureRoot: '/tmp/pss-mgba-captures-test',
        streamKeyframeInterval: 60,
        streamTileSize: 16,
        wsBackpressureLimit: 262_144,
        networkName: "pss-mgba-net",
      } satisfies Config,
      registry,
      instanceManager,
      { streamMetrics }
    )
  );

  return { app, instanceManager, streamMetrics };
}

function createInstanceInfo(id: string): InstanceInfo {
  return {
    id,
    token: `token-${id}`,
    containerId: `container-${id}`,
    containerHost: "127.0.0.1",
    captureDirectory: `/tmp/pss-mgba-captures-test/${id}`,
    status: "running",
    createdAt: new Date("2026-05-25T00:00:00Z"),
  };
}

function createFrame(overrides: Partial<CapturedFrame> = {}): CapturedFrame {
  return {
    instanceIndex: 0,
    instanceId: "instance-a",
    token: "token-instance-a",
    changedTiles: 0,
    frameType: StreamFrameType.Keyframe,
    height: 1,
    payload: Buffer.from([1, 2, 3]),
    payloadBytes: 3,
    rawBytes: 4,
    sequence: 1,
    tileSize: 16,
    timestampMs: 1000,
    width: 1,
    ...overrides,
  };
}
