# 004: Stuck After Winning a Battle

## Symptom

Agent defeated rival's Bulbasaur (HP=0) but remained in battle mode. The game showed post-battle dialog (EXP gained, level up) but the agent used `pokemon_wait` instead of advancing the dialog. Stuck for 10+ turns repeating `wait(60)`.

```
Turn 38: battle(fight:"Tackle") → move_used (Bulbasaur HP 0)
Turn 39: wait(60) → waited   ← reasoning: "Battle won! Wait for overworld."
Turn 40: wait(60) → waited
Turn 41: wait(120) → waited
...
```

`wIsInBattle` stayed 1, mode stayed `battle`, but the agent had no enemy to fight.

## Root Cause

`autoAdvanceBattleLoss` in `src/agent/CommandAgentRunner.ts` only handled the **loss** case (all party Pokemon fainted). It pressed A to exit the battle when the player lost, but did nothing when the player **won** (enemy HP=0).

```typescript
// Before: only handled party wipe
const allFainted = state.fullState.party.members.every(p => p.hp === 0);
if (!allFainted) return state;  // ← won the battle? do nothing.
```

The post-battle sequence (EXP, level-up, move learning) requires A presses to advance. When `advanceBattleNarration` in BattleExecutor stopped early (detecting a menu tile during animation), the remaining dialog was never advanced.

The agent then received a `battle` mode turn with enemy HP=0. It correctly reasoned "battle is over" but could only use `pokemon_wait` (which doesn't press A) or `pokemon_battle` (which requires a valid move against a live enemy). Neither advanced the stuck dialog.

## Fix

`src/agent/CommandAgentRunner.ts` — Extended `autoAdvanceBattleLoss` to also handle the victory case:

```typescript
// After: handle both loss and win
const partyAlive = state.fullState.party.members.some(p => p.hp > 0);
const enemyAlive = (state.fullState.battle.enemy?.hp ?? 1) > 0;
if (partyAlive && enemyAlive) return state;  // battle still active
// Either party wiped or enemy wiped → press A to exit
```

Now presses A up to 60 times whenever either side is defeated, advancing post-battle dialog until `wIsInBattle` drops to 0.
