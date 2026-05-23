# TypeScript Pokemon Harness

```
# install mgba & mgba-http, and extract gba rom file,

mgba --script .local-tools/mgba-http/mGBASocketServer.lua /Users/minpeter/github.com/tmp/pss-mgba/red-star.gb
.local-tools/mgba-http/mGBA-http

# setup .env file 

pnpm dev
```

## mGBA control plane

The harness exposes mGBA-http as PSS agent tools. Configure `.env` with:

```
MGBA_HTTP_BASE_URL=http://127.0.0.1:5000
MGBA_ROM_PATH=/absolute/path/to/game.gb
```

Run the autonomous Pokémon loop:

```
pnpm dev
```

The entrypoint always loops; there is no `--loop` flag, CLI prompt, max-turn budget, or completion stop condition. The hardcoded objective is sent through the same persistent `pokemon-run` session, and each `turn-end` immediately schedules the next `session.send(...)`.

Available tool actions cover ROM load, status, tap, multi-tap, hold, multi-hold, release, reset, and screenshot observation. The screenshot tool uses AI SDK `toModelOutput` content with an `image/png` file part so the next model step can inspect the current screen.

## Token usage metrics

Each model step records AI SDK token usage by turn and step. Runtime metrics are split into a current Prometheus view and per-run traces:

- `.pss-mgba/traces/iterations.jsonl`: append-only run iteration starts.
- `.pss-mgba/traces/runs/<run-id>/run.json`: metadata for one run/iteration.
- `.pss-mgba/traces/runs/<run-id>/token-usage.jsonl`: append-only events for every `llm-step` and `turn-summary` in that run.
- `.pss-mgba/metrics/token-usage.prom`: current-run Prometheus textfile gauges/counters suitable for node-exporter textfile collection or a later Grafana/Prometheus scrape path.

The same metrics are also printed as `{ type: "token-usage", metric: ... }` events in stdout. To compare iterations locally, run:

```
pnpm trace:report
```

The report shows turns, total tokens, average tokens per turn, and delta versus the previous run so prompt/control changes can be compared across repeated experiments. Positive `avgTokensSavedVsPrevious` / `improvementPercentVsPrevious` means the newer iteration did the run with fewer tokens per turn.


## Grafana dashboard

Start the local observability stack:

```
docker compose -f docker-compose.grafana.yml up -d
```

Then run the autonomous loop as usual:

```
pnpm dev
```

The agent exposes Prometheus metrics at `http://127.0.0.1:9464/metrics`. Prometheus scrapes that endpoint through `host.docker.internal:9464`, and Grafana provisions the `pss-mgba Run Iterations` dashboard at `http://127.0.0.1:3000`. Keep the Grafana/Prometheus stack running while experiments run so each new `run_id`/`iteration` is retained as a separate time series. Offline per-run traces are still written under `.pss-mgba/traces/runs/<run-id>/`. The dashboard includes proof-oriented panels for average tokens per turn by iteration, improvement percentage versus the previous run, average tokens saved per turn, and a comparison table.
