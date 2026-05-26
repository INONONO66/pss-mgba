# Agent Layer

LLM-driven agent that plays the game through tool calls.

## Modules

| File | Purpose |
|------|---------|
| `CommandAgentRunner.ts` | Main turn loop — prepare state, send to LLM, consume tool events, record evidence |
| `CommandAgentContext.ts` | Wires together all readers, executors, map memory, detector |
| `command-tools.ts` | Tool definitions (navigate, interact, dialog, battle, wait) + post-command handlers |
| `command-observation.ts` | Builds the per-turn observation string sent to the LLM |
| `dynamic-llm.ts` | Mode-specific system prompts, tool filtering, reasoning effort config |
| `memory-tools.ts` | Agent memory read/write tools (objectives, journal, notes, strategy) |
| `saveload-tools.ts` | Save state / load state / rollback tools |
| `AgentMemoryStore.ts` | Persistent agent memory (FIFO sections, JSON file) |

## Turn Loop

1. `waitForGameReady` — poll until `wJoyIgnore=0`, `wWalkCounter=0`
2. `readGameState` — read RAM, build full state snapshot
3. `autoAdvanceDialog` — if in dialog mode without a choice, advance it
4. `autoAdvanceBattleLoss` — if all party fainted, press A until battle exits
5. Build observation (map, party, battle, history, hints)
6. Send to LLM with mode-filtered tools
7. On first game-action tool result → interrupt the LLM turn
8. Record turn evidence (tool calls, game state before/after, screenshots)

## Post-Command Handling

`handlePostCommand` runs after every tool execution:

**Non-battle commands**: if dialog appeared as side effect → auto-advance once. Stops on `choice_appeared` / `battle_started`.

**Battle commands** (`handlePostBattleCommand`):
1. `waitForBattleExit`: if `wIsInBattle` still set, press A up to 40 times (handles trainer fadeout animations)
2. Loop up to 5 dialog rounds (EXP, level-up, move learning prompts)
3. Stop on interrupts: `choice_appeared`, `naming_screen`, `battle_started`
4. Set result to `battle_ended` if battle resolved without interrupts

## Tool Availability by Mode

| Mode | Tools |
|------|-------|
| overworld | navigate, interact, wait, save, load, rollback, memory |
| battle | battle, wait, memory |
| dialog | dialog, memory |
