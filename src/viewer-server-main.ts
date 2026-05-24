import { startViewerServer } from "./viewer-server";

const DEFAULT_VIEWER_HOST = "127.0.0.1";
const DEFAULT_VIEWER_PORT = 9474;
const DEFAULT_VIEWER_RUNS_DIR = ".pss-mgba/traces/runs";
const DEFAULT_VIEWER_STATIC_DIR = "web/dist";

startViewerServer({
  host: process.env.VIEWER_HTTP_HOST ?? DEFAULT_VIEWER_HOST,
  port: Number.parseInt(
    process.env.VIEWER_HTTP_PORT ?? String(DEFAULT_VIEWER_PORT),
    10
  ),
  runsDir: process.env.VIEWER_RUNS_DIR ?? DEFAULT_VIEWER_RUNS_DIR,
  staticDir: process.env.VIEWER_STATIC_DIR ?? DEFAULT_VIEWER_STATIC_DIR,
});
