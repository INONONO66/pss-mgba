// biome-ignore-all lint/style/useFilenamingConvention: Existing multi modules use PascalCase filenames.
import { Hono } from "hono";

import type { Config } from "../config.js";
import type { InstanceInfo } from "../instances/types.js";
import type { StreamMetrics } from "../streaming/StreamMetrics.js";
import type { InstanceRegistry } from "./ApiRouter.js";

export interface IInstanceManager {
  create(romPath?: string): Promise<InstanceInfo>;
  destroy(instanceId: string): Promise<void>;
  get(instanceId: string): InstanceInfo | undefined;
  list(): InstanceInfo[];
}

interface AdminRouterOptions {
  streamMetrics?: StreamMetrics;
}

export function createAdminRouter(
  config: Config,
  registry: InstanceRegistry,
  instanceManager: IInstanceManager,
  options: AdminRouterOptions = {}
): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const token = c.req.header("X-Admin-Token");
    if (token !== config.adminToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  });

  app.post("/instances", async (c) => {
    if (registry.size >= config.maxInstances) {
      return c.json({ error: "Max instances reached" }, 503);
    }

    const info = await instanceManager.create(config.romPath);
    return c.json({ id: info.id, token: info.token, status: info.status }, 201);
  });

  app.get("/instances", (c) => c.json(instanceManager.list()));

  app.get("/metrics/streams", (c) =>
    c.json(options.streamMetrics?.snapshot() ?? null)
  );

  app.get("/instances/:id", (c) => {
    const instance = instanceManager.get(c.req.param("id"));
    if (!instance) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json(instance);
  });

  app.delete("/instances/:id", async (c) => {
    const id = c.req.param("id");
    const instance = instanceManager.get(id);
    if (!instance) {
      return c.json({ error: "Not found" }, 404);
    }

    await instanceManager.destroy(id);
    registry.delete(instance.token);
    return c.json({ ok: true });
  });

  return app;
}
