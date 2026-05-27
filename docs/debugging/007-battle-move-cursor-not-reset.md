# 007: Battle Move Cursor Not Reset Between Turns

## Symptom

Agent selected "Ember" (slot 1) but the game executed "Scratch" (slot 0), or vice versa. The move actually used in battle did not match the move the agent requested. The mismatch was consistent: after using a move at index N, the next turn's move selection was off by N positions.

## Root Cause

`executeFight()` in `src/executor/BattleExecutor.ts` assumed the move cursor always starts at index 0 after entering the FIGHT submenu. It pressed `Down` N times to reach move index N.

```typescript
// Before: always navigates from position 0
for (let step = 0; step < moveIndex; step += 1) {
  await controller.pressButton("Down", QUICK_FRAMES);
}
```

In Pokemon Gen 1, `wCurrentMenuItem` (0xCC26) persists across turns. If the player selected move #2 last turn, the cursor stays at index 2 next turn. Pressing `Down` once from index 2 selects index 3, not index 1.

## Fix

`src/executor/BattleExecutor.ts` — Read `wCurrentMenuItem` via `dialogStateReader.readCurrentMenuItem()` after opening the FIGHT menu, then calculate the delta to navigate Up or Down from the current position.

```typescript
const cursorPos = dialogStateReader !== undefined
  ? await dialogStateReader.readCurrentMenuItem()
  : 0;
const delta = moveIndex - cursorPos;
if (delta > 0) {
  for (let step = 0; step < delta; step += 1) {
    await controller.pressButton("Down", QUICK_FRAMES);
  }
} else if (delta < 0) {
  for (let step = 0; step < -delta; step += 1) {
    await controller.pressButton("Up", QUICK_FRAMES);
  }
}
```

## Tests Added

- `tests/executor/BattleExecutor.test.ts`: "fight navigates Up when cursor is past the target move" — cursor at 2, target at 0, expects 2x Up presses
- `tests/executor/BattleExecutor.test.ts`: "fight skips cursor movement when already on the target move" — cursor at 1, target at 1, expects no Up/Down

## References

- `wCurrentMenuItem` at 0xCC26 in `src/game/data/red-blue-memory-profile.json`
- pokered source: `engine/battle/core.asm` — move menu does not reset `wCurrentMenuItem` between turns
