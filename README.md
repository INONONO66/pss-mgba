# TypeScript Pokemon Harness

Stage 1 is the default bounded Pokemon Red and Blue harness mode for mGBA-http. It reads RAM state, records evidence, chooses safe controller actions, and stops at the Stage 1 contract described below. An opt-in full-game mode exists, but it only treats Hall of Fame map observation as completion.

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
HARNESS_MODE=stage1
AI_PROVIDER=heuristic
```

`HARNESS_MODE` defaults to `stage1`. Set `HARNESS_MODE=full-game` or pass `--mode full-game` to opt into full-game detection. Full-game mode reads badge progress as a signal, but badges alone do not complete the run.

Set `AI_PROVIDER=heuristic` for local deterministic actions, or `AI_PROVIDER=openai` to select actions through the OpenAI-compatible Chat Completions policy. For CodexLB, keep `AI_PROVIDER=openai` and point `OPENAI_BASE_URL` at the CodexLB-compatible endpoint.

```text
OPENAI_BASE_URL=https://codex.nekos.me/v1
OPENAI_API_KEY=your-provider-key-in-dotenv-only
OPENAI_MODEL=gpt-5.5
OPENAI_TEMPERATURE=0.2
```

Heuristic mode does not need an API key. `AI_PROVIDER=openai` requires `OPENAI_API_KEY` and sends it only to `OPENAI_BASE_URL`. If `OPENAI_BASE_URL` points at a third-party OpenAI-compatible endpoint, put that provider's key in `OPENAI_API_KEY`; do not send a real OpenAI key to a third-party endpoint. `OPENAI_TEMPERATURE` is the non-secret sampling setting.

### Optional Vision Input

The harness is text-only by default. Set `LLM_VISION_ENABLED=true` only when the selected OpenAI-compatible provider and model support Chat Completions image inputs.

When enabled, each runner step takes the raw screenshot already captured by `snapshot()`, creates a processed image under the run's `vision/` directory, and passes only the latest `LLM_VISION_MAX_IMAGES` processed images to the LLM. The default rolling window is 3 images to keep context and cost bounded.

Vision settings:

```text
LLM_VISION_ENABLED=false
LLM_VISION_MAX_IMAGES=3
LLM_VISION_CROP_LEFT=0
LLM_VISION_CROP_TOP=0
LLM_VISION_CROP_WIDTH=0
LLM_VISION_CROP_HEIGHT=0
LLM_VISION_MAX_WIDTH=512
LLM_VISION_MAX_HEIGHT=384
LLM_VISION_FORMAT=jpeg
LLM_VISION_QUALITY=70
LLM_VISION_DETAIL=low
```

When crop width and height are `0`, the processor automatically trims black padding around the inner game image before resizing, falling back to the full screenshot only when the content area is ambiguous. Explicit crop settings override auto-crop and are applied before resizing. Processed images are resized to fit inside `LLM_VISION_MAX_WIDTH` by `LLM_VISION_MAX_HEIGHT` without enlargement, then encoded as `jpeg`, `webp`, or `png`. `LLM_VISION_QUALITY` applies to JPEG and WebP. Use explicit crop settings only when auto-crop cannot isolate the emulator core content cleanly.

Evidence and policy metadata store only file paths, dimensions, crop rectangles, byte counts, frame, step, media type, and detail. Base64 data URLs are created transiently in memory inside `LLMPolicy` for the outgoing Chat Completions request and are not written to events, decisions, summaries, errors, or tests snapshots.

## CLI Commands

Show help:

```bash
pnpm run harness --help
```

Print a redacted config summary without constructing mGBA or OpenAI clients:

```bash
pnpm run harness snapshot --dry-run
```

Run mGBA preflight against your already running mGBA-http service:

```bash
pnpm run harness preflight
```

Start the Stage 1 harness loop with the local heuristic policy:

```bash
pnpm run harness run --policy heuristic --mode stage1
```

Start a live Stage 1 LLM run through the configured OpenAI-compatible endpoint after setting `OPENAI_API_KEY` privately in `.env`:

```bash
pnpm run harness run --policy openai
```

Add `--vision` to require processed screenshot images in each LLM request. With `--vision`, the runner writes the processed files under `runs/<runId>/vision/` and the LLM policy refuses to send a text-only request if no processed image is available for the current decision.

```bash
pnpm run harness run --policy openai --vision
```

Start an opt-in full-game run. Completion is recorded only after observing Hall of Fame map id `0x76` through RAM-derived map state:

```bash
pnpm run harness run --mode full-game --policy openai
```

When `--run-id` is omitted, the harness generates one and prints it in the run output. Evidence still goes under `runs/<runId>/` by default, or under `EVIDENCE_DIR/<runId>/` when you configure a different evidence directory.

Omitted step and LLM call caps mean uncapped by that budget. Leaving out `--max-steps` and `LOOP_MAX_STEPS` leaves the loop without a step limit, and leaving out `MAX_LLM_CALLS` leaves LLM calls without a call limit. Safety still comes from the selected detector outcome, repeated-state and stuck detection, explicit caps when you set them, and manual stop.

Caps are opt in. Use them when you want a bounded local check:

```bash
pnpm run harness run --policy heuristic --max-steps 100
LOOP_MAX_STEPS=100 pnpm run harness run --policy openai
MAX_LLM_CALLS=25 pnpm run harness run --policy openai
MAX_LLM_CALLS=0 pnpm run harness run --policy heuristic
```

`--max-steps` overrides `LOOP_MAX_STEPS`. `--run-id` overrides `HARNESS_RUN_ID`. Explicit env caps apply when the matching CLI override is omitted.

Start the integrated dev viewer and full-game vision loop together:

```bash
pnpm run dev
```

`pnpm run dev` starts a local viewer at `http://127.0.0.1:8787` and runs the harness as a shared `run --policy openai --mode full-game --vision` session. The generated run id appears in the terminal output, and evidence still goes under `runs/<runId>/` by default, or under `EVIDENCE_DIR/<runId>/` when configured. The page shows the live mGBA screenshot on the left and the latest 1-3 processed files from `runs/<runId>/vision/` on the right, which are the same images currently available to the LLM context. It does not reprocess viewer screenshots, write emulator memory, bundle ROM assets, or persist base64 image data.

You can override run options after the script name. Normal `pnpm run dev` generates one shared run id for the session, and you can pass an explicit `--run-id` after the script name when you want a named dev run.

```bash
pnpm run dev --policy heuristic --max-steps 3
pnpm run dev --run-id manual
```

Inline terminal debug logs are enabled for `run` by default. They are safe summaries of decisions, actions, errors, and run-finished events. They are not raw chain-of-thought, prompts, model responses, screenshots, API keys, tokens, or base64 image data. Set `HARNESS_INLINE_DEBUG_LOGS=0`, `false`, `no`, or `off` to disable them.

To launch the same workflow in a tmux grid:

```bash
pnpm run dev:tmux
```

The tmux launcher still depends on mGBA-http. It creates panes for the mGBA-http process, mGBA with `mGBASocketServer.lua`, the harness/dev viewer, a live decision watcher, and a live processed-vision watcher. It reads `.env`, uses `POKEMON_ROM_PATH` for the mGBA pane, defaults to the workspace-local `.local-tools/mgba-http/` install, and passes one shared run id through every pane. The harness pane disables inline terminal debug logs because the watcher panes already show the same safe summaries without duplicates. Use `START_MGBA_HTTP=0` or `START_MGBA=0` when those processes are already running elsewhere. The launcher treats mGBA-http as ready only when `/core/currentframe` succeeds; if a stale server is listening but the emulator is not connected, panes stay open with that diagnostic. Add `--fresh` to stop an existing tmux session and restart local mGBA-http/mGBA processes before launching.

Useful launcher examples:

```bash
pnpm run dev:tmux --print
pnpm run dev:tmux --session pss-live --policy heuristic
pnpm run dev:tmux --fresh
START_MGBA_HTTP=0 START_MGBA=0 pnpm run dev:tmux
```

Send one safe button press for manual smoke checks:

```bash
pnpm run harness press A --frames 5
```

Run the opt-in real mGBA smoke workflow against an already running mGBA-http service:

```bash
RUN_MGBA_INTEGRATION=1 MGBA_HTTP_BASE_URL=http://127.0.0.1:5001 pnpm run smoke:mgba
```

`pnpm run smoke:mgba` refuses to contact mGBA unless both `RUN_MGBA_INTEGRATION=1` and `MGBA_HTTP_BASE_URL` are set. When enabled, it runs preflight, records a snapshot, presses safe `B` once, then records a second snapshot. It does not press `A`, start mGBA, open ROMs, load ROMs, or validate ROM files beyond the existing config summary showing whether `POKEMON_ROM_PATH` is present. Evidence is written under `runs/<runId>/` by default, or under `EVIDENCE_DIR/<runId>/` when configured.

Supported common options:

```text
--dry-run              Snapshot only. Prints config summary and exits.
--policy heuristic     Use the local heuristic policy.
--policy openai        Use the OpenAI-compatible policy. Requires OPENAI_API_KEY.
--mode stage1          Use the default Stage 1 detector.
--mode full-game       Use the opt-in full-game detector.
--vision               Enable and require processed LLM image input for snapshot, preflight, or run.
--max-steps N          Optional step cap override for snapshot or run. Omit it and LOOP_MAX_STEPS for no step cap.
--run-id ID            Optional HARNESS_RUN_ID override for evidence paths. Omit it to generate a run id.
--fresh                In dev:tmux, stop an existing session and local emulator bridge processes first.
DEV_VIEWER_PORT        Override the integrated dev viewer port; default is 8787.
LOOP_MAX_STEPS=N       Optional env step cap. Omit it for no step cap.
MAX_LLM_CALLS=N        Optional env LLM call cap. Omit it for no call cap; 0 allows zero LLM calls.
HARNESS_INLINE_DEBUG_LOGS=0|false|no|off
                       Disable inline terminal debug summaries for run.
START_MGBA_HTTP=0      In dev:tmux, do not start the mGBA-http pane process.
START_MGBA=0           In dev:tmux, do not start the mGBA emulator pane process.
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

The runner must base each action on current observed RAM state and recent actions. It must not use a global hardcoded input timeline. Evidence includes states, decisions, actions, screenshots, errors, and a final summary under `EVIDENCE_DIR`.

When an LLM-backed provider falls back to the local heuristic policy, the recorded decision rationale and citations are marked with `LLM fallback after <CODE>` so fallback-driven progress is distinguishable from LLM-selected actions.

## Full-Game Mode

Full-game mode is opt in through `HARNESS_MODE=full-game` or `--mode full-game`. It preserves the same safe-input and read-only-RAM rules as Stage 1.

The detector tracks early Stage 1 milestones, badge observation, all-badges observation, and Hall of Fame observation. It does not complete on Rival battle exit or all badges alone. Completion requires observing Hall of Fame map id `0x76` or the derived `hallOfFameComplete` state field.

The LLM full-game prompt treats badges as progress only, forbids memory writes and hardcoded global input timelines, and forbids route-facts-alone completion claims. The local heuristic policy remains a Stage 1-oriented fallback and does not claim reliable full-game clears.

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

The fake smoke workflow test runs in the default suite and uses dependency injection only; it does not contact mGBA.

## Limitations

This is an MVP harness for Pokemon Red and Blue. Stage 1 remains the default and best-supported mode. Full-game mode is an opt-in foundation with read-only progress signals and Hall of Fame-only completion detection; it does not include a full reliable game-clearing strategy. It does not bundle, download, or verify ROM files. It does not start emulator processes. It does not include OBS or Twitch integration. It does not write emulator memory.
