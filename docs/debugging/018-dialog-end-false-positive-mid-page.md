# 018: Dialog End False Positive During Page-Transition Flicker

## Observed In

Run `2026-06-06T07-07-32-442Z` turn 16. Symptom class also documented in
`docs/debugging/013-dialog-mode-mismatch-after-battle.md` as a known
limitation until this fix.

## Symptom

`DialogExecutor.advance()` returned `dialog_ended` while the actual game
state still had dialog active in the after-snapshot:

```json
"parsedCommand": { "type": "dialog", "action": { "kind": "advance" } },
"result": {
  "status": "success",
  "reason": "dialog_ended",
  "details": "transcript=[\"It encyclopedia- like but the\",\"like but the pages are blank!\"]"
},
"gameState": {
  "before": { "dialog": { "active": false, "letterPrintingDelayFlags": 1 } },
  "after":  { "dialog": { "active": true,  "letterPrintingDelayFlags": 3 } }
}
```

The next agent turn re-enters dialog mode (or worse, gets `mode_mismatch`
per issue 013).

## Analysis

Both `DialogExecutor.advance()` / `advanceAfterChoice()` and
`AutoHandler.advanceDialogFrom()` terminated on a single signal:
`rWY >= 144` (window register off-screen) for `WINDOW_HIDDEN_CONFIRM_COUNT = 2`
consecutive reads.

Per the `pret/pokered` disassembly:

- `CloseTextDisplay` (true dialog end) sets `hWY = $90` AND restores the
  overworld tilemap. The next VBlank propagates both atomically:
  `rWY = 144` AND the dialog text region decodes to empty.
- Page transitions WITHIN a single `PrintText` call (`PromptText`,
  `PageChar`, `_ContText`) call `ManualTextScroll`/`WaitForTextScrollButtonPress`.
  They do NOT call `CloseTextDisplay`. The tilemap retains the previous
  page until the next page is written over it.

A 1-2 frame race in mGBA-http RAM reads can surface `rWY >= 144` even when
the text engine is mid-page, because the harness reads the register at an
unrelated point in the frame. Two such reads in a row trigger the
2-read confirmation and prematurely declare the dialog over.

## Fix

Tighten both predicates to require BOTH conditions for the hidden streak
to advance:

1. `!isWindowVisible()` (the existing signal)
2. `screenText.trim().length === 0` (decoded tilemap shows no text)

When the window is hidden but the tilemap still holds dialog text, the
read is treated as a mid-page transition and the streak is reset
(`DialogExecutor`) or the loop sleeps+rereads without incrementing
`hiddenReads` (`AutoHandler`).

Changes:

- `src/executor/DialogExecutor.ts` lines 77-87 (in `advance()`) and
  lines 144-154 (in `advanceAfterChoice()`): added the mid-flicker
  branch `else if (state.screenText.trim().length > 0) { windowHiddenStreak = 0; }`.
  Press budget is bounded by the existing `MAX_DIALOG_PRESSES = 120`.
- `src/session/auto-handler.ts` `advanceDialogFrom`:
  added the mid-flicker branch that sleeps and rereads when
  `state.screenText.trim().length > 0`, mirroring the conservative
  posture of the existing hidden branch. Bounded by a new
  `MAX_DIALOG_FLICKER_POLLS = 10` (overridable via
  `AutoHandlerOptions.dialogFlickerPolls`); on cap the function returns
  `blocked / dialog_stuck` instead of spinning. Both counters reset on
  the visible-dialog branch so transient flicker doesn't leak state
  across pages.

Regression coverage:

- `tests/executor/DialogExecutor.test.ts`: "advance keeps pressing A on
  mid-page flicker when tilemap still shows dialog text" — fails on
  pre-fix code (transcript missing page 2); passes under the fix.
- `tests/session/auto-handler.test.ts`: "advances dialog through
  mid-page flicker when tilemap retains text" — same failure shape;
  passes under the fix.
- `tests/session/auto-handler.test.ts`: "returns blocked/dialog_stuck
  when state stays hidden with non-empty tilemap forever" —
  guards Oracle reviewer's required regression: without the
  `dialogFlickerPolls` cap, the mid-flicker branch could spin forever
  if RAM gets stuck. Configured with `dialogFlickerPolls: 3`; asserts
  the function returns instead of hanging.

## Chained Script Dialogs

The predicate fix above closes the mid-page flicker class but does NOT
on its own handle a related class where `CloseTextDisplay` truly fires
(tilemap cleared + `rWY = 144`) and the very next script tick opens a
new `PrintText` for a follow-up dialog (e.g., NPC line auto-leading into
the next, or scripted event triggered after a warp/interact).

In the run-16 evidence, `before.dialog.active = false` and
`after.dialog.active = true` are consistent with this chained-dialog
pattern: the executor's `dialog_ended` was correct for the first
dialog, but the next script tick opened a second dialog that the agent
re-encountered on the next turn.

### Chained-dialog fix (`command-tools.handlePostCommand`)

`handlePostCommand` previously ran a single `advanceDialog()` after a
non-battle command if the post-command state was in dialog mode. It now
loops up to `MAX_POST_COMMAND_DIALOG_ROUNDS = 5` rounds, mirroring
`handlePostBattleCommand`:

- After every `advanceDialog()` round, the state is refreshed; if it is
  still in dialog mode (script chained a new dialog), the loop runs
  another round.
- Breaks immediately on `choice_appeared`, `naming_screen`, or
  `battle_started` so player-input interrupts are not auto-advanced
  past.
- Breaks immediately on any non-`success`/non-`partial` dialog status
  (`failed`/`rejected`), so a `dialog_stuck` failure does not consume
  the full round budget while masking the failure.
- Dialog commands (`command.type === "dialog"`) early-return without
  entering the loop; the executor already advanced them, and entering
  the loop would risk pressing past pending player input.

`mergeDialogResult` was also updated to propagate `failed`/`rejected`
dialog statuses into the base command result (previously it preserved
the base status and only merged details, hiding failures). The
top-level `ok` flag in `runCommandTool` now derives from
`postCommand.result.status` instead of the original command's status,
so a post-command dialog failure correctly surfaces as `ok=false`.

Changes:
- `src/agent/command-tools.ts`: added `MAX_POST_COMMAND_DIALOG_ROUNDS`
  constant; replaced the single-pass `if` with a bounded `for` loop;
  factored the dialog early-return; tightened `mergeDialogResult`
  failure propagation; corrected `ok` derivation in `runCommandTool`.

Regression coverage in `tests/agent/command-tools.test.ts`:
- "loops post-command dialog rounds when a chained dialog appears after
  the first advance" — feeds `[overworld, dialog, dialog, overworld]`
  state queue + 3 mock results (interact, advance1, advance2); asserts
  final state is overworld, executeCommandMock called 3 times,
  transcript contains both pages. Fails on pre-fix code (final state
  "dialog", 2 mock calls).
- "stops post-command dialog loop on choice_appeared for chained dialog"
  — second-round advance returns `choice_appeared`; asserts the loop
  breaks and the result surfaces the interrupt instead of the original
  command's success. Fails on pre-fix code (result stays
  `interacted/success`).
- "stops post-command dialog loop and surfaces dialog_stuck when
  executor fails to end dialog" — second mock returns
  `failed/dialog_stuck`; asserts the loop breaks at the first failure
  (executeCommandMock called exactly 2 times instead of 6), the result
  surfaces `failed/dialog_stuck`, and the top-level `ok` flag is
  `false`. Guards Oracle reviewer round 2 finding.

## Status

**Fixed**: mid-page flicker predicate (DialogExecutor + auto-handler)
AND chained-script dialog re-entry (`handlePostCommand`). The
mode-classification single-shot read limitation documented in 013
remains open — it is a different read path and out of scope for this
fix.
