# 013: Dialog Mode Mismatch — Agent Sends Dialog Command in Overworld

## Observed In

Run `2026-05-26T17-38-49-774Z`, turn 1.

## Symptom

Agent was in Oak's Lab after a rival battle. Screen showed dialog text: `"AAAAAAA Yeah! Am I great or what?"`. Agent correctly identified dialog mode and sent `dialog(advance)`. The command was **rejected** with `mode_mismatch: Cannot use dialog in overworld mode`.

```json
{
  "command": {"type": "dialog", "action": {"kind": "advance"}},
  "result": {"status": "rejected", "reason": "mode_mismatch",
             "details": "Cannot use dialog in overworld mode"}
}
```

## Analysis

The game state showed:
- `screenText`: "AAAAAAA Yeah! Am I great or what?" (dialog text visible)
- `dialog.active`: false (RAM says no dialog)
- Mode classified as: `overworld`

The mode classification in `GameWorld.ts` checks `rWY < 144` for dialog detection. At this exact moment, the game was between dialog pages — `rWY` was briefly >= 144 (window hidden) while the text engine prepared the next page. The harness read RAM at this flicker moment and classified the mode as overworld.

## Impact

One wasted turn. The agent recovered by moving to overworld commands on the next turn. The `handlePostCommand` auto-dialog handler in `command-tools.ts` handles this case for non-dialog commands — if dialog appears after a navigate/interact, it auto-advances. But when the agent explicitly sends a dialog command in what the harness thinks is overworld mode, it's rejected.

## Status

**Known limitation.** The `WINDOW_HIDDEN_CONFIRM_COUNT = 2` in DialogExecutor already mitigates this for dialog detection (requires 2 consecutive hidden reads). But mode classification in `readGameWorld()` does a single-shot read without confirmation. A potential fix would be to add a brief re-check when mode flags are ambiguous (dialog text present but rWY >= 144), but this adds latency to every state read.

## Workaround

The agent naturally recovers — overworld commands trigger the auto-dialog handler, which advances the pending dialog.
