# 017: 7-Turn no_path Loop in Red's House 1F

## Observed In

Run `2026-05-26T17-38-49-774Z`, turns 3–9.

## Symptom

After warping from Red's House 2F to 1F, the agent attempted to navigate to the exit warp at `(3,7)` but every navigate command returned `no_path`. The agent tried multiple targets over 7 turns:

```
Turn 3: navigate(3,7) → no_path
Turn 4: navigate(6,2) → no_path
Turn 5: navigate(7,2) → no_path
Turn 6: navigate(6,1) → no_path
Turn 7: wait(30)
Turn 8: navigate(5,4) → no_path
Turn 9: interact(down) → success (workaround)
```

The map at this point showed 47% explored:

```
   01234567
 0 ???#####
 1 ???#...@
 2 ???.....
 3 ???.....
 4 ???##N..
 5 ???##...
 6 ????????
 7 ??WW????
```

## Root Cause

Three bugs compounded to create this situation (all documented separately):

1. **#008**: Unknown tiles (`???`) were treated as walls → left half and bottom of map impassable
2. **#009**: Partial offscreen blocks corrupted edge tiles → walkable tiles near screen edges became walls
3. **#010**: Player's tile `(7,1)` was a stair/door tile classified as `wall+door` → pathfinder rejected start position immediately

The agent had no way to navigate because:
- Start position was non-walkable (issue #010)
- All paths to the exit crossed unknown territory (issue #008)
- Some previously explored tiles had been corrupted to walls (issue #009)

## Resolution

The agent eventually worked around the bug by using `interact(down)` (turn 9), which pressed A and caused the player to face down. This didn't directly solve the pathfinding but changed the player's screen position slightly, revealing new tiles. Subsequent `navigate` commands to nearby tiles eventually worked (turns 10-11), and by turn 12 the agent reached the exit warp.

## All Three Fixes Required

- Issue #008 fix (unknown=walkable) alone was insufficient — start tile was still wall
- Issue #010 fix (door/warp=passable) alone was insufficient — path still crossed unknown walls
- Issue #009 fix (skip partial offscreen) prevented the situation from worsening but didn't unblock existing corrupt data

All three fixes together resolve this class of post-warp stuck behavior.

## Turns Wasted

7 turns (turns 3-9) out of 12 total. 58% of the entire run was spent stuck.
