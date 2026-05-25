const WORLD_RULES = `World Rules
- Treat the game as a tile grid: movement attempts step one tile in a cardinal direction unless blocked.
- Warps are special W tiles or doorway/stair tiles that move between maps after stepping onto them.
- Indoor and outdoor areas connect through doors, stairs, cave mouths, gates, and other warp tiles.
- Walls, counters, furniture, ledges from the wrong side, signs, people, and scenery are impassable.
- If a movement command fails, infer collision or a temporary blocker from observed state; do not assume hidden paths.
- Facing matters for interactions: stand adjacent to a target, face it, then interact if the command set supports that.`;

const PROGRESSION_MODEL = `Progression Model
- Game progress means triggering events at specific locations, not merely crossing distance.
- Badges and resolved story events unlock travel options, NPC permissions, services, or new map access.
- New area access usually appears after a blocking story event clears, an NPC changes state, or an item/key permission exists.
- Walking onto specific tiles, talking to specific NPCs, having specific items, or entering a map can trigger events.
- A location that seemed blocked can become valid later, but only after observed state shows a relevant change.
- Treat progress as state transitions: changed dialog, moved blockers, new inventory, healed party, battle start, or map transition.`;

const NPC_RULES = `NPC Rules
- Stationary NPCs are often story-important; talk with them when nearby and other evidence is unclear.
- Moving NPCs are usually flavor, blockers, or local hints; avoid repeated chatter unless their position blocks movement.
- Counter, desk, shop, nurse, gym, and gate NPCs must usually be faced from the front side before interacting.
- If dialog repeats and nothing in observed state changes, that NPC is probably not relevant right now.
- Prefer nearby untried stationary or counter NPCs over repeating recently unchanged dialog.
- NPCs that physically block a corridor, door, or route often represent a missing event rather than a pathfinding error.`;

const STUCK_PATTERNS = `Stuck Patterns
- Same map for many turns means try a different exit, untried NPC, visible warp, doorway, staircase, or route branch.
- Same position after movement means try a different direction, face and interact, or choose a nearby passable-looking tile.
- Repeated command failures mean switch approach instead of issuing the same failed command again.
- "Can't go that way" or equivalent blocking feedback usually means a prerequisite event, permission, item, or NPC state is elsewhere.
- Repeated unchanged dialog means stop asking that NPC and test another interaction or transition.
- If an exit loops back, inspect other indoor doors, counter interactions, nearby signs, or map edges before repeating it.`;

const OUTPUT_RULES = `Output Rules
- Output exactly one JSON object per turn.
- Only use provided command types.
- Base decisions on observed state only.
- No memory writes or emulator manipulation.
- The JSON should choose one legal command and explain the immediate game-state reason briefly.
- Do not invent unseen map facts, future milestones, hidden inventory, or out-of-band emulator actions.
- Prefer reversible, local checks when uncertain: observe, face, interact, or test a nearby legal move based on current evidence.`;

export function buildGameKnowledge(): string {
  return [
    WORLD_RULES,
    PROGRESSION_MODEL,
    NPC_RULES,
    STUCK_PATTERNS,
    OUTPUT_RULES,
  ].join("\n\n");
}
