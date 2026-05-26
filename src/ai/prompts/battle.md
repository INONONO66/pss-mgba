=== AVAILABLE COMMANDS ===

battle(action)
  Use battle(fight/item/switch/run) for battle decisions.
  Actions:
    fight(move) - Attack using move by name. Must have PP > 0.
    item(item) - Use item from bag by name. Includes Poke Ball to catch wild Pokemon.
    switch(pokemon) - Switch to pokemon by nickname. Must not be fainted.
    run - Flee. Only works in wild battles.

=== BATTLE STRATEGY ===

Move Selection:
- Prefer super-effective moves (2x damage). Type chart matters more than base power.
- STAB (Same Type Attack Bonus) gives 1.5x; a 60-power STAB move outdamages a 75-power non-STAB.
- Use high-power damaging moves over status moves in most fights.
- Check PP before selecting; 0 PP = unusable.
- If all moves are resisted, switch to a Pokemon with better coverage.

HP Management:
- Use Potion/Super Potion if active Pokemon HP < 30% and it can still contribute.
- In trainer battles, preserve HP across fights; heal between encounters when possible.
- If active Pokemon is badly weakened and a healthy teammate has type advantage, switch instead of healing.
- Do not waste healing items on Pokemon that will be knocked out next turn anyway.

When to Run (Wild Battles Only):
- Run from wild battles that do not serve a purpose (not catching, not grinding).
- Do NOT run if: the wild Pokemon is a recommended catch (see catch rules below), or you are intentionally grinding levels.
- Cannot run from trainer battles; must fight to win.

When to Grind:
- If party lead is 3+ levels below area trainers/gym leader, grind on wild Pokemon first.
- Grind near a Pokemon Center so you can heal between sessions.
- Focus EXP on your primary team (4-6 Pokemon), not extras sitting in the box.

=== CATCHING WILD POKEMON ===

When to Catch:
- Catch a Pokemon if it fills a type gap your party lacks (see party goals below).
- Catch Pokemon that learn essential HMs: Fly, Surf, Cut, Strength, Flash.
- Catch Pokemon that give you a type advantage for the next gym.
- Do NOT waste Poke Balls on duplicates of species you already own.
- If you have fewer than 5 Poke Balls, only catch high-priority targets.

How to Catch:
- Weaken the target to low HP first (red zone). Below 1/3 HP is optimal for Poke Ball and Ultra Ball; below 1/2 HP for Great Ball.
- Status conditions greatly improve catch rate: Sleep and Freeze are best, Paralysis is good, Burn/Poison work but risk fainting the target.
- Throw the ball with item(ball_name). Use the best ball available: Ultra Ball > Great Ball > Poke Ball.
- If the catch fails, weaken further or inflict status, then try again.
- Do not use your last ball; keep at least 1 in reserve.

Priority Catches by Area:
- Route 1-2: Pidgey or Spearow (Flying; needed for Fly HM later).
- Viridian Forest: Pikachu (Electric; rare but valuable for Misty/water Pokemon).
- Route 3-4: Nidoran M/F (evolves with Moon Stone into powerful Nidoking/Nidoqueen).
- Mt. Moon: Clefairy (rare; Moon Stone is the real prize here).
- Route 24-25: Abra (Psychic type, strongest in Gen 1; hard to catch, teleports immediately — throw ball turn 1 or use Sleep).
- Diglett's Cave: Diglett/Dugtrio (Ground; excellent for Lt. Surge).
- Route 6-11: Oddish/Bellsprout (Grass; useful for Misty if starter is not Bulbasaur).
- Pokemon Tower: Gastly (Ghost/Poison; evolves into strong Gengar via trade).
- Safari Zone: Chansey, Kangaskhan, Tauros, Dratini (rare but powerful).
- Seafoam Islands: Articuno (legendary Ice/Flying).
- Power Plant: Zapdos (legendary Electric/Flying), Electabuzz.

=== ITEM USAGE IN BATTLE ===

Healing Items:
- Potion: restores 20 HP. Use early game only.
- Super Potion: restores 50 HP. Primary healing mid-game.
- Hyper Potion: restores 200 HP. Use late game.
- Full Restore: full HP + cures status. Save for gym leaders and Elite Four.
- Revive: revives fainted Pokemon to half HP. Use only in critical trainer battles.

Status Cure:
- Antidote: cures Poison. Use immediately; poison drains HP while walking.
- Parlyz Heal: cures Paralysis. Important since paralysis halves Speed.
- Awakening: cures Sleep.
- Full Heal: cures any status. Carry 2-3 for gym leaders.

Poke Balls:
- Poke Ball ($200): use early game, routes 1-11.
- Great Ball ($600): use mid-game, routes 12+.
- Ultra Ball ($1200): use for rare/legendary Pokemon.

Output: {"command": {"type": "...", ...}, "rationale": "..."}