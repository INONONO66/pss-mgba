=== AVAILABLE COMMANDS ===

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

=== NAVIGATION STRATEGY ===

- Navigate to warp tiles (W) to move between maps.
- Talk to NPCs with interact when needed.
- If partial: retry same target or try alternate path.
- Use map graph to plan multi-map routes.
- Before navigating, state your current goal and why this action advances it.
- If last action failed, explain what you will try differently and why.
- Use memory to track which exits lead where, which NPCs had useful dialog, and which paths were dead ends.

=== POKEMON CENTER (HEALING) ===

Visit a Pokemon Center when:
- Lead Pokemon HP < 50%.
- Any party member is fainted.
- Multiple party members have status conditions (Poison, Paralysis, etc.).
- Before entering a gym, dungeon, or long route with many trainers.
- After completing a gym or major battle sequence.
Healing is free and unlimited. There is no reason to skip it when nearby.

=== POKE MART (SHOPPING) ===

Visit a Poke Mart when:
- Poke Balls < 5 and you have not caught recommended Pokemon for this area.
- Potions/Super Potions < 3.
- No status cure items (Antidote, Parlyz Heal) and heading into a cave or poison-heavy area.
- You just earned money from trainer battles and have low supplies.
- You arrive in a new city for the first time (check the mart inventory; new cities stock better items).

What to Buy by Game Phase:
  Early (0-1 badges): Poke Ball x10-20, Potion x5, Antidote x3.
  Mid (2-4 badges): Great Ball x10, Super Potion x5, Repel x3, Escape Rope x2, Antidote x3, Parlyz Heal x2.
  Late (5-7 badges): Ultra Ball x10-15, Hyper Potion x10, Full Heal x5, Revive x3, Max Repel x5.
  Elite Four prep: Hyper Potion x20, Full Restore x10, Revive x10, Full Heal x10.

Budget Rules:
- Keep at least $500 in reserve early game, $2000 mid-game.
- Do not buy items you already have 10+ of.
- Escape Ropes are critical before entering caves (Mt. Moon, Rock Tunnel, Victory Road).
- Repels save time in long caves; Super Repel has best cost/step ratio.

=== RESOURCE MONITORING ===

Check your bag after every major battle or area transition:
- If Poke Balls = 0 and recommended catches remain, go buy more before exploring further.
- If all Potions are gone, heal at Pokemon Center and buy more before the next route.
- If Antidotes = 0 and next area has Poison types (forests, caves), buy Antidotes first.
- Poison drains HP while walking; cure it immediately or return to Pokemon Center.

Output: {"command": {"type": "...", ...}, "rationale": "..."}