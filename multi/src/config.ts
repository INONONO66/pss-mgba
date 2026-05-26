import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().min(1).max(65_535).default(8787),
  adminToken: z.string().min(1),
  maxInstances: z.coerce.number().int().min(1).max(10).default(10),
  emulatorImage: z.string().default("pss-mgba-emulator"),
  emulatorPort: z.coerce.number().int().min(1).max(65_535).default(8888),
  emulatorMemoryBytes: z.coerce.number().int().positive().default(768 * 1024 * 1024),
  captureIntervalMs: z.coerce.number().int().min(1).max(10_000).default(8),
  sourceCaptureIntervalMs: z.coerce.number().int().positive().default(60_000),
  captureRoot: z.string().min(1).default("/tmp/pss-mgba-captures"),
  streamKeyframeInterval: z.coerce.number().int().positive().default(60),
  streamTileSize: z.coerce.number().int().min(4).max(128).default(16),
  wsBackpressureLimit: z.coerce.number().int().min(1024).max(10_485_760).default(262_144),
  networkName: z.string().default("pss-mgba-net"),
  romPath: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse({
    port: process.env.PORT,
    adminToken: process.env.ADMIN_TOKEN ?? "dev-admin-token",
    maxInstances: process.env.MAX_INSTANCES,
    emulatorImage: process.env.EMULATOR_IMAGE,
    emulatorPort: process.env.EMULATOR_PORT,
    emulatorMemoryBytes: process.env.EMULATOR_MEMORY_BYTES,
    captureIntervalMs: process.env.CAPTURE_INTERVAL_MS,
    sourceCaptureIntervalMs: process.env.SOURCE_CAPTURE_INTERVAL_MS,
    captureRoot: process.env.CAPTURE_ROOT,
    streamKeyframeInterval: process.env.STREAM_KEYFRAME_INTERVAL,
    streamTileSize: process.env.STREAM_TILE_SIZE,
    wsBackpressureLimit: process.env.WS_BACKPRESSURE_LIMIT,
    networkName: process.env.NETWORK_NAME,
    romPath: process.env.ROM_PATH,
  });
}
