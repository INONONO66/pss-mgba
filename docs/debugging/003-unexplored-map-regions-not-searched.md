# 003: Agent Does Not Explore Unknown Map Regions

## Symptom

Agent entered Oak's Lab to deliver Oak's Parcel. The lab map showed the bottom half explored and the top half as `?` (unknown). Prof. Oak was at position (5,2) in the unexplored top area, but the agent only interacted with visible NPCs (two Scientists, one Girl) in the bottom half, then left without delivering the parcel.

```
   0123456789
 0 ??????????  ← Oak is here at (5,2) — invisible
 1 ??????????
 2 ??????????
 3 ??????????
 4 ??????????
 5 ??????????
 6 ??????????
 7 ?###..####  ← explored from here down
 8 ?9........
 9 ?.........
10 ?.a.....b.  ← Scientists (a,b)
11 ?...W@....  ← Player at entrance
```

Run log turns 19-25: agent navigated to each visible NPC, got irrelevant dialog, then gave up and left the lab.

## Root Cause

The overworld system prompt (`src/ai/prompts/overworld.md`) had no guidance about exploring `?` tiles. The agent treated unknown regions as empty/irrelevant rather than as areas that need to be walked into to reveal their contents.

Indoor maps like labs, gyms, and houses are taller than one Game Boy screen (160x144 pixels = 20x18 tiles = 10x9 blocks). When the player enters from the bottom, only the bottom portion is visible. The top portion remains `?` until the player walks up.

## Fix

Added an `=== EXPLORATION ===` section to `src/ai/prompts/overworld.md`:

- `?` tiles are unexplored, not empty — NPCs, items, and key characters hide there
- Enter a building → explore the entire map before deciding nobody is there
- Indoor maps are usually taller than one screen; walk into `?` regions
- Key NPCs (Prof. Oak, Gym Leaders) are typically at the far end from the entrance
- If the target NPC is not in the visible list, they are likely in a `?` area

## Affected Scenarios

- Delivering Oak's Parcel (Oak at top of lab, player enters at bottom)
- Any gym where the Gym Leader is at the back
- Multi-floor buildings (Pokemon Tower, Silph Co., etc.)
- Any building where important NPCs or items are off-screen from the entrance
