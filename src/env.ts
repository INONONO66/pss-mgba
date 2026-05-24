import { createEnv } from "@t3-oss/env-core";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ path: ".env", quiet: true, override: true });

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
    AI_BASE_URL: z.url().default("https://codex.nekos.me/v1"),
    AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().min(1).default("gpt-5.5"),
    AI_REASONING: reasoningEffort,
    METRICS_HTTP_HOST: z.string().min(1).default("0.0.0.0"),
    METRICS_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(9464),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
