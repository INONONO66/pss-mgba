# TypeScript Pokemon Harness

Full-game is the default Pokemon Red and Blue harness target for mGBA-http. It reads RAM state, records evidence, chooses safe controller actions, and treats stable Hall of Fame map observation as completion. Stage 1 remains available for early-game validation.

This project does not bundle a ROM. You must provide your own legal Pokemon Red or Pokemon Blue ROM and load it in mGBA yourself.

## Safety First

If an API key was ever pasted into chat, rotate it now. Treat it as exposed. Put new keys only in `.env`, never in source, tests, shell history, README edits, or evidence files.

Run `pnpm run check:secrets` before sharing changes. The scanner checks project text files for OpenAI-style `sk-` values while skipping generated, dependency, run, and evidence directories such as `node_modules`, `.git`, `runs`, `coverage`, and `dist`.

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
OPENAI_BASE_URL=http://127.0.0.1:3100/v1
OPENAI_API_KEY=your-provider-key-in-dotenv-only
OPENAI_MODEL=grok-4.3
OPENAI_TEMPERATURE=0.2
```

Agent runs require `OPENAI_API_KEY`; it is sent only to `OPENAI_BASE_URL`. If `OPENAI_BASE_URL` points at a third-party OpenAI-compatible endpoint, put that provider's key in `OPENAI_API_KEY`; do not send a real OpenAI key to a third-party endpoint. `OPENAI_TEMPERATURE` is the non-secret sampling setting.

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

`run` and `agent` are equivalent commands. Both start the `CommandAgentRunner`, which uses the AI SDK to issue high-level game commands (navigate, interact, battle, dialog) through structured actions.

For the recommended full-game launch path:

```bash
pnpm run harness:full-game --run-id local-full-game
```

That script expands to `run --max-turns 1500`. It requires mGBA-http, your own loaded ROM, and `OPENAI_API_KEY` in `.env`.

Start the integrated dev viewer and agent together:

```bash
pnpm run dev
```

`pnpm run dev` starts a local viewer at `http://127.0.0.1:8787` and runs the command agent. The page shows the live mGBA screenshot, raw screenshot history, current RAM-derived game state, per-turn prompts/responses/actions, global memory, and map memory. It does not write emulator memory, bundle ROM assets, or persist base64 image data.

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

## Stage 1 Contract

Stage 1 means the harness attempts to progress from the Pallet start through Oak and starter flow, starter acquisition, Rival battle entry, and Rival battle exit.

The agent must base each action on current observed RAM state and recent actions. It must not use a global hardcoded input timeline. Evidence is written under `EVIDENCE_DIR/<runId>/` with per-turn JSON in `turns/`, global memory and run summary in `global/`, raw screenshots, and errors.

## Full-Game Mode

Full-game mode is the default through `HARNESS_MODE=full-game`. It preserves the same safe-input and read-only-RAM rules as Stage 1. Set `HARNESS_MODE=stage1` for early-game validation.

The detector tracks early Stage 1 milestones, badge observation, all-badges observation, and Hall of Fame observation. It does not complete on Rival battle exit or all badges alone. Completion requires two consecutive observations of Hall of Fame map id `0x76` or the derived `hallOfFameComplete` state field.

The agent full-game prompt treats badges as progress only, forbids emulator/RAM memory writes and hardcoded global input timelines, and forbids route-facts-alone completion claims.

## Upstream Runtime Utilities

This fork keeps its richer Pokemon state reader and memory map as the authoritative
model context source. The upstream runtime refresh has been pulled in as additive
utilities for future wiring: run traces, behavior metrics, token usage tracking,
Prometheus/Grafana assets, stuck-movement memory, and screenshot normalization.
Do not replace `src/pokemon/memoryMap.ts`, `src/pokemon/PokemonStateReader.ts`,
`src/pokemon/GameWorld.ts`, `src/pokemon/MapMemory.ts`, or the modular readers
with the compact upstream `src/pokemon-state.ts` reader.

`src/pokemon/memoryMap.ts` keeps the compatibility exports used by the runtime,
but its Red/Blue WRAM symbols are sourced from the conservative JSON profile at
`src/pokemon/data/red-blue-memory-profile.json`. Future game support should add a
new profile and loader wiring instead of hardcoding another address table in
TypeScript. This profile foundation does not by itself implement another game.

The optional upstream trace report command is available as:

```bash
pnpm run trace:report
```

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

This is an MVP harness for Pokemon Red and Blue. Full-game mode is the default target, with Stage 1 still available for early-game validation. Completion requires read-only Hall of Fame observation; the project does not include a guaranteed full-game strategy. It does not bundle, download, or verify ROM files. It does not start emulator processes. It does not include OBS or Twitch integration. It does not write emulator memory.
