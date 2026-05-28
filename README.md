# grokemon

<p align="center">
  <img src="assets/grokemon.png" alt="grokemon banner" width="100%">
</p>

Grok plays Pokemon Red from emulator state alone.

Default harness: no guides, no scripts, no web-search tool.

Grokemon started from the original `pss-mgba` harness and now focuses on one constraint: beat Pokemon Red by reading emulator state and pressing only normal Game Boy buttons.

No ROM is bundled. No emulator memory writes are used. The agent can only press A, B, Start, Select, and the D-pad.

## How it works

```text
Grok
  ↓ OpenAI-compatible chat model
CommandAgentRunner
  ↓ session observation + mode-filtered tools
CommandExecutor
  ↓ InputGate-settled button presses
mGBA-http / grokemon multi gateway
  ↓ RAM, screenshots, frames
Pokemon Red
```

Each turn follows the same loop:

1. Wait until input is safe (`wJoyIgnore`, walk animation, text window state).
2. Read RAM-backed game state, mini-state, map memory, party, battle, dialog, and progress detector state.
3. Render a compact session observation with current mode, available tools, events, memory, history, and supervisor hints.
4. Let Grok call exactly one game-action tool for the current mode.
5. Route that command through executors that translate it into safe button presses.
6. Auto-handle immediate dialog, battle narration, and input settling where the code can prove it is safe.
7. Record turn logs, screenshots, session events, map memory, and command history under `runs/<run-id>/`.

## Runtime invariants

- **No normal-run web search:** the agent tool surface is driven by RAM state, prompt rules, local memory, and supervisor feedback. Optional supervisor integrations can be configured separately, but the game-action loop does not browse or search.
- **No memory writes:** all game interaction goes through Game Boy inputs.
- **One game action per turn:** the runner interrupts after the first game-action tool result.
- **Mode-gated tools:** overworld, battle, and dialog expose different tool sets.
- **Input-gated buttons:** every press waits for the emulator to settle before the next action.
- **Recoverable runs:** evidence, screenshots, map memory, agent memory, and savestate tooling make failures inspectable.

## Quick start

```bash
pnpm install
cp .env.example .env
```

Edit `.env` with:

```text
MGBA_HTTP_BASE_URL=http://127.0.0.1:5001
POKEMON_VERSION=red
HARNESS_MODE=full-game
OPENAI_BASE_URL=https://api.x.ai/v1
OPENAI_API_KEY=your-key-in-dotenv-only
OPENAI_MODEL=grok-4.3
OPENAI_TEMPERATURE=0.2
```

Then start either:

- mGBA with mGBA-http enabled and a legal Pokemon Red ROM loaded, or
- the local multi-instance gateway in `multi/`.

Run:

```bash
pnpm run harness preflight              # verify emulator connectivity
pnpm run harness run --max-turns 100    # start a bounded run
pnpm run harness:full-game              # full-game attempt, 1500 turns
pnpm run dev                            # dev viewer in standby mode
```

Useful options:

```bash
pnpm run harness run --run-id run-a --max-turns 200 --reasoning medium
pnpm run harness run --load-slot 8      # resume from auto-checkpoint slot
pnpm run harness press A --frames 5     # manual safe button press
```

## Multi-instance gateway

`multi/` runs a single Docker container that spawns up to 10 local `mgba-sdl` processes. It exposes:

- admin APIs for creating and destroying emulator instances,
- mGBA-http-compatible per-instance game APIs,
- dashboard and per-instance WebSocket frame streams.

```bash
cd multi
pnpm install
ROM_PATH=/absolute/path/to/roms docker compose -f docker/docker-compose.yml up -d --build
curl http://localhost:8787/health
```

Create an instance, then point `MGBA_HTTP_BASE_URL` at the returned token URL:

```text
MGBA_HTTP_BASE_URL=http://localhost:8787/api/v1/<token>
```

See `multi/README.md` for the gateway API and environment variables.

## Main commands

| Command | Purpose |
|---------|---------|
| `pnpm run harness --help` | Show CLI usage |
| `pnpm run harness preflight` | Check mGBA/mGBA-http connectivity |
| `pnpm run harness run` | Start the Grok agent loop |
| `pnpm run harness agent` | Alias for `run` |
| `pnpm run harness:full-game` | Run `run --max-turns 1500` |
| `pnpm run harness press BUTTON` | Send one safe manual button press |
| `pnpm run dev` | Start the dev viewer; agent is controlled over WebSocket |

## Code map

| Path | Role |
|------|------|
| `src/agent/` | Runner, tool factory, observation builder, persistent memory, session bridge |
| `src/session/` | Mini-state, input gate, transition detector, session state contracts |
| `src/template/` | Tagged session observation renderer and tool/memory/history fragments |
| `src/executor/` | Command router and overworld/dialog/battle executors |
| `src/game/` | RAM readers, detector, map memory, map graph, Pokemon catalogs |
| `src/supervisor/` | Stuck detection, goal ledger, adviser hints, intervention loop |
| `src/evidence/` | Run folders, turn JSON, screenshots, redaction |
| `src/viewer/` | Dev viewer HTTP/WebSocket server |
| `multi/` | Single-container multi-emulator gateway and dashboard |
| `scripts/` | Build, safety, smoke, and live-test utilities |

## Verification

```bash
pnpm run check:secrets
pnpm run check:session-authority
pnpm run typecheck
pnpm test
pnpm run smoke:memory-map-build
```

Full check:

```bash
pnpm run check
```

Live integration tests require a running emulator or gateway:

```bash
RUN_MGBA_INTEGRATION=1 MGBA_HTTP_BASE_URL=http://127.0.0.1:5001 pnpm run test:integration
```

## Notes

- Keep ROMs out of git. Provide your own legal Pokemon Red or Blue ROM.
- Use savestate slot `1` for a clean reset point and slot `8` for the runner's auto-checkpoint.
- Public branding is Grokemon; internal protocol/schema names may still mention `pss-mgba` where compatibility matters.
