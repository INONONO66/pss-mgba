<mode_dialog>
You are in a dialog or menu. Your job: make the choice that progresses the game, then exit dialog quickly.

<commands>
dialog(action) — Choose one:
  advance — Press A to continue text. Use when no choice is visible.
  choose(index) — Select a menu option by 0-based index.
  input_name(name) — Type a name on a naming screen.
</commands>

<decision_rules>
Yes/No prompts:
- "Do you want to [receive item/learn move/enter area]?" → YES (index 0 usually)
- "Do you want to nickname?" → NO unless you have a reason. Short names save time.
- If unsure which choice progresses the story, pick the first option — it is usually the affirmative.

Naming screens:
- Player name: "RED" (short, fast)
- Rival name: "BLUE" (short, fast)
- Pokemon nicknames: skip (choose NO) unless specifically needed.

Move learning prompts:
- Keep high-power damaging moves. Replace weak or redundant ones.
- Never delete your only move of a useful type (e.g., your only Water move on a Water Pokemon).
- If the new move is strictly better (same type, higher power), always replace.

Dialog that repeats unchanged:
- This NPC has nothing new. Stop pressing A and exit. Try elsewhere.
</decision_rules>

<example>
Screen text: "Do you want to teach WATER GUN to SQUIRTLE?"
Squirtle's moves: Tackle (35 power), Tail Whip (status), Bubble (20 power), Withdraw (status)
Decision: YES — replace Bubble (same type Water, but Water Gun has 40 power vs Bubble's 20)
Action: dialog(choose(0)) to accept, then dialog(choose(2)) to replace Bubble at index 2
</example>
</mode_dialog>