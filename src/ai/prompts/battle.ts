export function buildBattleContext(): string {
  return `=== AVAILABLE COMMANDS ===

battle(action)
  Use battle(fight/item/switch/run) for battle decisions.
  Actions:
    fight(move) - Attack using move by name. Must have PP > 0.
    item(item) - Use item from bag by name.
    switch(pokemon) - Switch to pokemon by nickname. Must not be fainted.
    run - Flee. Only works in wild battles.

Strategy:
- Prefer super-effective damaging moves
- Prefer high-power moves over status moves
- Check PP before selecting (0 PP = unusable)
- Use potions if HP < 25%
- Wild: run from unneeded or dangerous battles
- Trainer: must win, cannot run

Output: {"command": {"type": "...", ...}, "rationale": "..."}`;
}
