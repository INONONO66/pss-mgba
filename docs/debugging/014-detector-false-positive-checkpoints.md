# 014: Detector False Positive Checkpoints at Game Start

## Observed In

Run `2026-05-26T17-38-49-774Z` turn 1, run `2026-05-26T18-47-06-029Z` turn 1, run `2026-05-27T05-54-14-188Z` turn 1.

## Symptom

The FullGameDetector marked `badgesObserved: true` and `starterAcquired: true` on the very first step, even though the player had 0 badges, 0 party members, and an empty bag. The detector checkpoint evidence showed:

```json
{
  "checkpoint": "badgesObserved",
  "step": 1,
  "observed": {
    "wPartyCount": 0,
    "wObtainedBadges": 0,
    "badgeCount": 0
  }
}
```

The agent's observation displayed: `Completed: Observe starting area, Obtain starter Pokemon, Observe first badge` — all false positives.

## Analysis

The `FullGameDetector` uses threshold-based checks. The `badgesObserved` checkpoint fires when `wObtainedBadges` is observed (even if 0 — the check is "has the value been read", not "is it > 0"). Similarly, `starterAcquired` may trigger when `wPartyCount` is read regardless of its value, depending on the implementation.

In run `2026-05-26T17-38-49-774Z`, the evidence showed `wIsInBattle: 1` and `wPartyCount: 1` at step 1 — this was a mid-battle save state where the rival battle was already in progress. The detector saw party=1 and marked starter as acquired.

In run `2026-05-27T05-54-14-188Z`, the game started fresh from Red's House 2F with `wPartyCount: 0`, but `badgesObserved` was still marked true — suggesting the check condition is too loose.

## Impact

The agent receives incorrect milestone information:
- `Next milestone: Enter Rival battle` when starter hasn't been obtained yet
- Skips the "get starter Pokemon" objective entirely
- May attempt to leave Pallet Town without a Pokemon

## Status

**Open issue.** The checkpoint logic in `FullGameDetector.ts` needs stricter conditions:
- `starterAcquired` should require `wPartyCount >= 1`
- `badgesObserved` should require `wObtainedBadges > 0` (or a specific badge bit set)
- Checkpoints should not fire on the initial state read if values are at defaults
