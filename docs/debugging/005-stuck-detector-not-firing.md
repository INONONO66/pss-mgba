# 005: Stuck Detector Never Fires

## Symptom

Agent sat in Viridian Mart at position (0,7) for 130+ turns doing nothing but `wait(30)`. The supervisor's stuck detector should have triggered after 4-5 repeated actions, but never did. No adviser hint was generated.

```
Turn 129: wait(30) → waited   reason: "Wait for dialog."
Turn 130: wait(30) → waited   reason: "Wait."
Turn 131: wait(30) → waited   reason: "Wait."
...
Turn 257: wait(30) → waited   reason: "Wait."
```

## Root Cause

In `src/cli/index.ts`, the `recentActions` array was declared on line 176 but **never populated**:

```typescript
const recentActions: unknown[] = [];  // declared
// ...
onTurnStart: (turn, state) => {
  recentStates.push(state.fullState);  // ✓ populated
  // recentActions.push(???)           // ✗ never called
  orchestrator.update({
    recentActions: recentActions.slice(-20),  // always empty []
    recentStates: recentStates.slice(-20),
  });
}
```

StuckDetector's stuck condition requires **both** signals:
```typescript
const stuck = repeated.count >= 4    // recentActions — always 0 ← broken
           && stable.count >= 5;     // recentStates — worked fine
```

`recentActions` was always empty → `trailingRepeat` returned count=0 → the AND condition was never met → stuck was never detected.

No `recentActions.push()` call existed anywhere in the codebase.

## Fix

`src/cli/index.ts` — Added `recentActions.push(state.fullState)` in the `onTurnStart` callback, alongside the existing `recentStates.push()`.

StuckDetector's `actionSignature()` falls back to `stableSignature()` for non-action objects, which extracts `mapId`, `position`, `battle`, `textBox`, etc. from fullState. This makes it detect repeated identical game states as repeated "actions."

## Why It Wasn't Caught

- StuckDetector had unit tests, but they tested `analyzeStuckSignals()` directly with mock data
- The CLI integration (wiring `recentActions`) was never tested end-to-end
- The supervisor's `getAdviserHint()` silently returned the rendered plan when not stuck, so there was no visible error
