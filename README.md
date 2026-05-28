# grokemon

<p align="center">
  <img src="assets/grokemon.png" alt="grokemon banner" width="100%">
</p>

Grok plays Pokemon Red from emulator state alone.

No guides, no scripts, no web search.

This repository started from the original `pss-mgba` harness and now keeps that lineage explicit while moving the concept toward a Grok-only self-playing run.

No ROM bundled. No emulator memory writes. Safe Game Boy inputs only.

## What it does

- Reads Pokemon Red RAM and screen-derived map state through mGBA-http.
- Builds a compact per-turn observation for Grok.
- Lets Grok choose one safe game command per turn.
- Executes only normal Game Boy inputs: A, B, Start, Select, and D-pad.
- Records evidence logs and screenshots for debugging failed runs.
- Uses local state, prompt memory, and supervisor feedback instead of web search.

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env with your mGBA-http URL and OpenAI-compatible Grok API key
```

Start mGBA with mGBA-http and your Pokemon Red ROM loaded, then:

```bash
pnpm run harness preflight          # verify mGBA connection
pnpm run harness run --max-turns 100 # start agent
pnpm run harness:full-game           # full game attempt (1500 turns)
pnpm run dev                         # standby dev viewer at :8787
```

## Environment

```text
MGBA_HTTP_BASE_URL=http://127.0.0.1:5001
POKEMON_VERSION=red
OPENAI_BASE_URL=https://api.x.ai/v1
OPENAI_API_KEY=your-key-in-dotenv-only
OPENAI_MODEL=grok-4.3
OPENAI_TEMPERATURE=0.2
```

## Architecture

See [AGENTS.md](./AGENTS.md) for full architecture, module map, and Pokemon domain knowledge.

```
Grok → CommandAgentRunner → CommandExecutor → mGBA-http
         ↕                    ↕
      MapMemory           RAM readers
      Supervisor          Button presses
      Evidence
```

The agent loop: read game state → build observation → Grok picks a tool → execute command → auto-advance dialog/narration → record evidence → repeat.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm run harness preflight` | Check mGBA connection |
| `pnpm run harness run` | Start agent loop |
| `pnpm run harness:full-game` | Full game attempt |
| `pnpm run harness press A` | Single button press |
| `pnpm run dev` | Dev viewer without auto-starting the agent |

Options: `--max-turns N`, `--run-id ID`, `--reasoning MODE`

## Testing

```bash
pnpm run check          # secrets + typecheck + test + smoke
pnpm test               # unit tests only
pnpm run typecheck      # TypeScript
```

Integration tests require a running mGBA instance:

```bash
RUN_MGBA_INTEGRATION=1 MGBA_HTTP_BASE_URL=http://127.0.0.1:5001 pnpm run test:integration
```

## Project Structure

```
src/
  agent/       Agent runner, Grok tools, observation builder
  ai/prompts/  Markdown prompt fragments (world rules, battle, dialog)
  cli/         CLI entry, config, dev launcher
  control/     Command/action type definitions
  evidence/    Turn-based JSON logs and screenshots
  executor/    Command → button press translation + RAM detection
  game/        RAM readers, map memory, tile classification, text codec
  mgba/        mGBA-http client
  supervisor/  Stuck detection and no-web-search recovery feedback
  viewer/      Dev viewer HTTP server
scripts/       Build utilities and live test scripts
tests/         Unit tests (no network required)
```
