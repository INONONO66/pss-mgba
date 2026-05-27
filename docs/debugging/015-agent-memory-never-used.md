# 015: Agent Memory Never Written During Early Game

## Observed In

Run `2026-05-26T17-38-49-774Z` (12 turns), run `2026-05-26T18-18-05-504Z` (5 turns), run `2026-05-26T18-47-06-029Z` (5 turns).

## Symptom

Across all observed runs, the agent memory remained completely empty after every turn:

```json
"agentMemory": {
  "sections": {
    "objectives": [],
    "journal": [],
    "notes": [],
    "strategy": []
  }
}
```

The `pokemon_memory_write` and `pokemon_memory_read` tools were listed in available tools but never called. The agent spent 12 turns navigating without recording any observations, map connections, or objectives.

## Analysis

The agent had access to memory tools but the LLM never chose to call them. Several factors contributed:

1. **No memory on first turn.** With empty memory, the agent has no context to build on. The LLM sees empty sections and doesn't prioritize writing to them.

2. **Single tool call per turn.** The output rules require exactly one game-action tool call per turn. Memory tools are explicitly note-only tools (`note tools alone are invalid`). The agent must choose between a game action and a memory write — it always chose game actions.

3. **Prompt pressure.** The system prompt emphasizes immediate game actions. Memory rules exist but are secondary to the action commands. The agent optimizes for "do something in the game" over "record what I learned."

4. **Short runs.** With only 5-12 turns before getting stuck, the agent never reached a point where it needed to recall past observations.

## Impact

- No persistent knowledge across turns (which map exits go where, which NPCs were talked to)
- Agent repeatedly attempts the same failed actions without learning from history
- No strategic planning recorded (team composition goals, next objectives)

## Mitigation Applied

Enhanced `memory-rules.md` with concrete guidance on what to record per section:
- `objectives`: 1-3 active goals, updated when completed
- `journal`: team changes, milestones, catches
- `notes`: map connections, shop inventories, NPC hints
- `strategy`: gym plans, grinding decisions

## Status

**Partially addressed.** The enhanced prompts should encourage memory usage, but the fundamental tension between "one game action per turn" and "also write to memory" remains. A potential improvement would be to allow memory writes as a side effect alongside game actions, rather than requiring a separate tool call.
