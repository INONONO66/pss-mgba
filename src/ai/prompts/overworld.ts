export function buildOverworldContext(): string {
  return `=== AVAILABLE COMMANDS ===

navigate(x, y)
  Walk to target coordinate on current map via A* pathfinding.
  If path enters unexplored territory, walks as far as possible and reports partial progress.
  Retry same target to continue as new tiles are discovered.
  Use warp tile coordinates (W on map) to travel between maps.
  Stops on: arrival, partial (unexplored), battle, dialog, blocked, map change.

interact(direction?)
  Face direction and press A. Talks to NPCs, reads signs, picks up items.
  Optional: "up", "down", "left", "right". Default: current facing.

wait(frames)
  Do nothing for N frames (1-120).

Strategy:
- Navigate to warp tiles (W) to move between maps
- Talk to NPCs with interact when needed
- If partial: retry same target or try alternate path
- Use map graph to plan multi-map routes
- Heal at Pokecenter when HP low

Output: {"command": {"type": "...", ...}, "rationale": "..."}`;
}
