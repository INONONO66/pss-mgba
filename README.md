# pss-mgba

AI agent harness that plays Pokemon Red/Blue on mGBA. Reads RAM state, issues safe button inputs through mGBA-http, and runs until Hall of Fame completion.

No ROM bundled. No emulator memory writes. Safe Game Boy inputs only.

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env with your mGBA-http URL and OpenAI-compatible API key
```

Start mGBA with mGBA-http and your ROM loaded, then:

```bash
pnpm run harness preflight          # verify mGBA connection
pnpm run harness run --max-turns 100 # start agent
pnpm run harness:full-game           # full game (1500 turns)
pnpm run dev                         # agent + dev viewer at :8787
```

## Environment

```text
MGBA_HTTP_BASE_URL=http://127.0.0.1:5001
POKEMON_VERSION=red
OPENAI_BASE_URL=https://your-provider/v1
OPENAI_API_KEY=your-key-in-dotenv-only
OPENAI_MODEL=gpt-4o
OPENAI_TEMPERATURE=0.2
```

## Architecture

See [AGENTS.md](./AGENTS.md) for full architecture, module map, and Pokemon domain knowledge.

```
LLM → CommandAgentRunner → CommandExecutor → mGBA-http
         ↕                    ↕
      MapMemory           RAM readers
      Supervisor          Button presses
      Evidence
```

The agent loop: read game state → build observation → LLM picks a tool → execute command → auto-advance dialog/narration → record evidence → repeat.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm run harness preflight` | Check mGBA connection |
| `pnpm run harness run` | Start agent loop |
| `pnpm run harness:full-game` | Full game run (1500 turns) |
| `pnpm run harness press A` | Single button press |
| `pnpm run dev` | Agent + dev viewer |

Options: `--max-turns N`, `--run-id ID`, `--reasoning MODE`

## Testing

```bash
pnpm run check          # secrets + typecheck + test + smoke
pnpm test               # unit tests only
pnpm run typecheck      # TypeScript
```

Integration tests (requires running mGBA):
```bash
RUN_MGBA_INTEGRATION=1 MGBA_HTTP_BASE_URL=http://127.0.0.1:5001 pnpm run test:integration
```

## Project Structure

```
src/
  agent/       Agent runner, LLM tools, observation builder
  ai/prompts/  Markdown prompt fragments (world rules, battle, dialog)
  cli/         CLI entry, config, dev launcher
  control/     Command/action type definitions
  evidence/    Turn-based JSON logs and screenshots
  executor/    Command → button press translation + RAM detection
  game/        RAM readers, map memory, tile classification, text codec
  mgba/        mGBA-http client
  supervisor/  Stuck detection, LLM adviser, walkthrough search
  viewer/      Dev viewer HTTP server
scripts/       Build utilities and live test scripts
tests/         Unit tests (no network required)
```
