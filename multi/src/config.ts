import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().default(8787),
  adminToken: z.string().min(1),
  maxInstances: z.coerce.number().int().min(1).max(10).default(10),
  emulatorImage: z.string().default("pss-mgba-emulator"),
  emulatorPort: z.coerce.number().default(8888),
  captureIntervalMs: z.coerce.number().int().positive().default(100),
  jpegQuality: z.coerce.number().int().min(1).max(100).default(60),
  wsBackpressureLimit: z.coerce.number().int().positive().default(262_144),
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
    captureIntervalMs: process.env.CAPTURE_INTERVAL_MS,
    jpegQuality: process.env.JPEG_QUALITY,
    wsBackpressureLimit: process.env.WS_BACKPRESSURE_LIMIT,
    networkName: process.env.NETWORK_NAME,
    romPath: process.env.ROM_PATH,
  });
}
