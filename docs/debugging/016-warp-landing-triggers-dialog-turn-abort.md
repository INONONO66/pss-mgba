# 016: Warp Landing Triggers Unexpected Dialog and Turn Abort

## Observed In

Run `2026-05-26T17-38-49-774Z` turn 12, run `2026-05-27T05-54-14-188Z` turn 1.

## Symptom

After warping from Red's House 1F to Pallet Town (or from 2F to 1F), the game state showed `dialog.active: true` and `joyIgnore: 255` in the after-state. The turn ended with `turn-abort` immediately after the warp tool result, without the agent getting a chance to handle the dialog.

Run `2026-05-26T17-38-49-774Z` turn 12:
```json
"after": {
  "mapId": 0,
  "mapName": "Pallet Town",
  "dialog": {"active": true, "joyIgnore": 255}
}
```
Timeline: tool-result → step-end → step-start → turn-abort.

Run `2026-05-27T05-54-14-188Z` turn 1:
```json
"after": {
  "mapId": 37,
  "mapName": "Reds House 1f",
  "dialog": {"active": true, "joyIgnore": 255}
}
```
Same abort pattern.

## Analysis

In Pokemon Gen 1, certain map transitions trigger scripted events:
- Exiting Red's House for the first time → Prof. Oak stops you (dialog)
- Entering a new indoor map → potential NPC greeting or cutscene

When `handlePostCommand` detects dialog after a non-dialog command, it auto-advances the dialog. But the warp result is `interrupted: map_changed`, which triggers a turn boundary. The agent never gets the auto-dialog handler's chance to clear the scripted dialog.

The `joyIgnore: 255` means the game is blocking all player input during the scripted sequence. The harness reads this as dialog-active but the turn has already been aborted.

## Impact

- The next turn starts in dialog mode and must handle the pending scripted dialog
- One extra turn is consumed to advance the auto-dialog
- If the agent tries an overworld command on the next turn while dialog is still active, it gets mode_mismatch (see issue #013)

## Status

**Known limitation.** The `handlePostCommand` auto-dialog handler does run after battle commands but the turn-abort on `map_changed` interrupts happen before it can fire for navigate commands. A potential fix would be to check for dialog state after map_changed interrupts and auto-advance before returning the result, but this risks interfering with intentional scripted sequences that require player choices.
