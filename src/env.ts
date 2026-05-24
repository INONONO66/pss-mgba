import { isAbsolute } from "node:path";
import { createEnv } from "@t3-oss/env-core";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ path: ".env", quiet: true, override: true });

const absolutePath = z
  .string()
  .min(1, "MGBA_ROM_PATH is required")
  .refine(
    (value) => isAbsolute(value),
    "MGBA_ROM_PATH must be an absolute path"
  );

const reasoningEffort = z
  .enum([
    "provider-default",
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ])
  .default("medium");

export const env = createEnv({
  server: {
    MGBA_HTTP_BASE_URL: z.url().default("http://127.0.0.1:5000"),
    MGBA_ROM_PATH: absolutePath,
    AI_BASE_URL: z.url().default("https://codex.nekos.me/v1"),
    AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().min(1).default("gpt-5.5"),
    AI_REASONING: reasoningEffort,
    AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
    METRICS_HTTP_HOST: z.string().min(1).default("0.0.0.0"),
    METRICS_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(9464),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
