<stuck_recovery>
When you detect you are stuck, escalate through these levels. Do NOT skip levels.

<level_1 trigger="same position after 2 failed moves">
Try a different cardinal direction. If facing a wall, turn and move along it.
</level_1>

<level_2 trigger="same map for 5+ turns with no new tiles revealed">
- Check the map for untried warp tiles (W) or unexplored ? regions.
- Navigate to the nearest ? area or warp you have not used.
- Talk to a stationary NPC you have not tried yet.
</level_2>

<level_3 trigger="10+ turns with no progress (no new map, no event, no battle won)">
- pokemon_memory_read("objectives") — recheck what you are supposed to do.
- pokemon_memory_read("notes") — check if you recorded a hint about where to go.
- Consider: is there a prerequisite you missed? An item to fetch? An NPC to talk to elsewhere?
- Try a completely different map exit or go back to the last town.
</level_3>

<level_4 trigger="15+ turns stuck, all nearby options exhausted">
- Leave the current area entirely. Return to the last Pokemon Center.
- Re-read all memory sections for missed clues.
- Pick a different objective from memory or head to the next city on the map graph.
- If in a dungeon with Escape Rope, use it.
</level_4>

<common_traps>
- "Can't go that way" = a prerequisite event, key item, or HM is needed. Go find it elsewhere.
- NPC blocks a corridor and repeats dialog = a story event elsewhere must trigger first. Leave and progress the story.
- Exit loops back to same room = there is another exit (warp, stairs, or hidden path) you have not tried.
- Obtained a key item but nothing changed = find the NPC or location that needs it. Check memory notes.
- Same coordinate keeps failing = try 1-2 tiles adjacent to your target instead.
</common_traps>
</stuck_recovery>