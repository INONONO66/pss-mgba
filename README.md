# TypeScript Pokemon Harness

A full-game Pokemon Red and Blue harness for mGBA-http. It reads RAM state, records evidence, chooses safe controller actions, and treats stable Hall of Fame map observation as completion.

This project does not bundle a ROM. You must provide your own legal Pokemon Red or Pokemon Blue ROM and load it in mGBA yourself.

## Safety First

If an API key was ever pasted into chat, rotate it now. Treat it as exposed. Put new keys only in `.env`, never in source, tests, shell history, README edits, or evidence files.

Run `pnpm run check:secrets` before sharing changes. The scanner checks project text files for OpenAI-style `sk-` values while skipping generated, dependency, run, and orchestration evidence directories such as `node_modules`, `.git`, `runs`, `coverage`, `dist`, and `.omo`.

The harness never writes emulator memory. It uses safe Game Boy inputs only: `A`, `B`, `Start`, `Select`, `Up`, `Down`, `Left`, and `Right`.

## Setup

1. Install Node.js 20 or newer.
2. Install dependencies.

```bash
pnpm install
```

3. Copy the example env file.

```bash
cp .env.example .env
```

4. Edit `.env` for your local machine. Keep `.env` private.

5. Start mGBA-http, then start mGBA with `mGBASocketServer.lua` loaded and your legal ROM loaded. The harness CLI will not download ROMs.

On macOS, port `5000` may already be owned by Control Center/AirTunes. If so, run mGBA-http on `5001` and set `MGBA_HTTP_BASE_URL=http://127.0.0.1:5001`.

The mGBA 0.10.5 app can load scripts through Tools > Scripting. Newer mGBA HEAD builds also support non-interactive script loading:

```bash
brew install mgba --HEAD
mgba --script .local-tools/mgba-http/mGBASocketServer.lua /absolute/path/to/legal/rom.gb
```

Keep mGBA-http running separately. Download `mGBA-http` and `mGBASocketServer.lua` from the official mGBA-http release, or use the workspace-local `.local-tools/mgba-http/` install if it exists on your machine.

## Environment

Common settings:

```text
MGBA_HTTP_BASE_URL=http://127.0.0.1:5001
POKEMON_VERSION=red
POKEMON_ROM_PATH=/absolute/path/to/legal/rom.gb
EVIDENCE_DIR=runs
```

The command agent runner uses the AI SDK with an OpenAI-compatible provider. Set the API key and endpoint in `.env`:

```text
OPENAI_BASE_URL=https://codex.nekos.me/v1
OPENAI_API_KEY=your-provider-key-in-dotenv-only
OPENAI_MODEL=gpt-5.5
OPENAI_TEMPERATURE=0.2
```

`OPENAI_API_KEY` is required and sent only to `OPENAI_BASE_URL`. If `OPENAI_BASE_URL` points at a third-party OpenAI-compatible endpoint, put that provider's key in `OPENAI_API_KEY`; do not send a real OpenAI key to a third-party endpoint. `OPENAI_TEMPERATURE` is the non-secret sampling setting.

### Vision Support (Deferred)

Vision input for the command agent runner is not yet implemented. The existing vision processing infrastructure (`ScreenshotProcessor`, vision image settings) remains available for future integration but is not wired into the agent loop.

## CLI Commands

Show help:

```bash
pnpm run harness --help
```

Run mGBA preflight against your already running mGBA-http service:

```bash
pnpm run harness preflight
```

Start the command agent loop:

```bash
pnpm run harness run --max-turns 100 --run-id local-agent
```

`run` and `agent` are equivalent commands. Both start the `CommandAgentRunner`, which uses the AI SDK to issue high-level game commands (navigate, interact, battle, dialog) through tool calls.

For the recommended full-game launch path:

```bash
pnpm run harness:full-game --run-id local-full-game
```

That script expands to `run --max-turns 1500`. It requires mGBA-http, your own loaded ROM, and `OPENAI_API_KEY` in `.env`.

Start the integrated dev viewer and agent together:

```bash
pnpm run dev
```

`pnpm run dev` starts a local viewer at `http://127.0.0.1:8787` and runs the command agent. The page shows the live mGBA screenshot, raw game screenshot history, current RAM-derived game state, detailed run events with agent tool-call/tool-result evidence, and LLM conversation artifacts. It does not write emulator memory, bundle ROM assets, or persist base64 image data.

You can override run options after the script name, for example:

```bash
pnpm run dev --max-turns 3 --run-id local-dev-viewer
```

Send one safe button press for manual smoke checks:

```bash
pnpm run harness press A --frames 5
```

Supported common options:

```text
--max-turns N          Maximum agent turns for the run.
--run-id ID            Override HARNESS_RUN_ID for evidence paths.
--reasoning MODE       Set reasoning effort: provider-default, none, minimal, low, medium, high, xhigh.
DEV_VIEWER_PORT        Override the integrated dev viewer port; default is 8787.
```

`press` also accepts `--frames N`.

## Preflight

`preflight` checks the configured mGBA-http endpoint in this order:

1. Config summary.
2. Current frame endpoint.
3. `wCurMap` RAM read.
4. `wYCoord` RAM read.
5. `wXCoord` RAM read.
6. Screenshot endpoint.
7. Safe `B` tap.

If mGBA is absent, the command exits nonzero and prints setup guidance instead of a raw stack trace. Start mGBA manually, enable mGBA-http, load your own ROM, then confirm `MGBA_HTTP_BASE_URL` points to it.

## Full-Game Mode

The harness runs full-game only. It preserves safe-input and read-only-RAM rules throughout.

The detector tracks badge observation, all-badges observation, and Hall of Fame observation. Completion requires two consecutive observations of Hall of Fame map id `0x76` or the derived `hallOfFameComplete` state field. All-badges alone does not trigger completion.

The agent prompt treats badges as progress only, forbids memory writes and hardcoded global input timelines, and forbids route-facts-alone completion claims.

## Memory Map Profile

`src/pokemon/memoryMap.ts` keeps the compatibility exports used by the runtime, but its Red/Blue WRAM symbols are sourced from the conservative JSON profile at `src/pokemon/data/red-blue-memory-profile.json`. Future game support should add a new profile and loader wiring instead of hardcoding another address table in TypeScript. This profile foundation does not by itself implement another game.

The Grafana/Prometheus assets are under `observability/` and can be started with:

```bash
docker compose -f docker-compose.grafana.yml up -d
```

## Tests

Run the default checks:

```bash
pnpm run check:secrets
pnpm run typecheck
pnpm test
```

Integration tests are opt in so the default suite never contacts mGBA, OpenAI, ROMs, or the network:

```bash
RUN_MGBA_INTEGRATION=1 MGBA_HTTP_BASE_URL=http://127.0.0.1:5001 pnpm run test:integration
```

Only enable integration tests when mGBA-http is already running with your ROM loaded.

## Limitations

This is an MVP harness for Pokemon Red and Blue. It runs full-game only, with read-only progress signals and Hall of Fame-only completion detection. It does not include a full reliable game-clearing strategy. It does not bundle, download, or verify ROM files. It does not start emulator processes. It does not include OBS or Twitch integration. It does not write emulator memory.
