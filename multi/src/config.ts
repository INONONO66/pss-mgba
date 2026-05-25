import { z } from 'zod'

const ConfigSchema = z.object({
  port: z.coerce.number().min(1).max(65535).default(8787),
  adminToken: z.string().min(1),
  maxInstances: z.coerce.number().min(1).max(100).default(10),
  baseLuaPort: z.coerce.number().min(1).max(65535).default(8888),
  mgbaBinary: z.string().default('mgba-sdl'),
  luaScriptPath: z.string().default('/app/mGBASocketServer.lua'),
  frameDir: z.string().default('/tmp/frames'),
  romPath: z.string().optional(),
  captureIntervalMs: z.coerce.number().min(10).max(10000).default(100),
  jpegQuality: z.coerce.number().min(1).max(100).default(60),
  wsBackpressureLimit: z.coerce.number().min(1024).max(10_485_760).default(262_144),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(): Config {
  return ConfigSchema.parse({
    port: process.env.PORT,
    adminToken: process.env.ADMIN_TOKEN ?? 'dev-admin-token',
    maxInstances: process.env.MAX_INSTANCES,
    baseLuaPort: process.env.BASE_LUA_PORT,
    mgbaBinary: process.env.MGBA_BINARY,
    luaScriptPath: process.env.LUA_SCRIPT_PATH,
    frameDir: process.env.FRAME_DIR,
    romPath: process.env.ROM_PATH,
    captureIntervalMs: process.env.CAPTURE_INTERVAL_MS,
    jpegQuality: process.env.JPEG_QUALITY,
    wsBackpressureLimit: process.env.WS_BACKPRESSURE_LIMIT,
  })
}
