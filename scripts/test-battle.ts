import { MgbaHttpClient } from "../src/mgba/MgbaHttpClient.js";
import { PokemonStateReader } from "../src/game/PokemonStateReader.js";
import { readGameWorld } from "../src/game/GameWorld.js";
import { readFullGameState } from "../src/game/readers/FullGameStateReader.js";
import { RED_BLUE_MEMORY_MAP } from "../src/game/memoryMap.js";
import { executeBattle, type BattleController } from "../src/executor/BattleExecutor.js";
import type { BattleCommand } from "../src/control/CommandTypes.js";

async function main() {
  const client = new MgbaHttpClient({ baseUrl: "http://127.0.0.1:5001" });
  const stateReader = new PokemonStateReader({ client, version: "red" });
  const map = RED_BLUE_MEMORY_MAP;

  const state = await stateReader.readState();
  console.log(`Position: map=${state.wCurMap} y=${state.wYCoord} x=${state.wXCoord}`);
  console.log(`Battle: ${state.wIsInBattle} (0=none, 1=wild, 2=trainer)`);
  console.log(`Party: ${state.wPartyCount}`);

  if (state.wIsInBattle === 0) {
    console.log("\nNot in battle! Walk into grass or trigger a trainer first.");
    return;
  }

  const world = await readGameWorld(client);
  console.log(`Mode: ${world.mode}`);

  const coords = await stateReader.readOverworldState();
  const facing = await stateReader.readPlayerFacingState();
  const badges = await stateReader.readBadgeState();
  const menuText = await stateReader.readMenuTextState();

  const fullState = await readFullGameState({
    client,
    coordinates: coords,
    playerFacing: facing,
    badges,
    menuText,
  });

  console.log(`\n=== BATTLE STATE ===`);
  console.log(`Type: ${fullState.battle.type}`);
  if (fullState.battle.enemy) {
    const e = fullState.battle.enemy;
    console.log(`Enemy: ${e.species} Lv${e.level} HP ${e.hp}/${e.maxHp} (${e.types.join("/")})`);
    console.log(`Enemy moves: ${e.moves.map(m => m.name).join(", ")}`);
  }

  console.log(`\n=== YOUR POKEMON ===`);
  const lead = fullState.party.members[0];
  if (lead) {
    console.log(`${lead.nickname} Lv${lead.level} HP ${lead.hp}/${lead.maxHp}`);
    console.log(`Moves:`);
    for (const m of lead.moves) {
      console.log(`  - ${m.name} (PP ${m.pp})`);
    }
  }

  const firstMoveWithPP = lead?.moves.find(m => m.pp > 0);
  if (!firstMoveWithPP) {
    console.log("\nNo moves with PP! Cannot fight.");
    return;
  }

  console.log(`\n=== EXECUTING: battle(fight:"${firstMoveWithPP.name}") ===`);

  const controller: BattleController = {
    async pressButton(button, frames = 5) {
      console.log(`  > press ${button} (${frames}f)`);
      await client.holdButton(button, frames);
      await new Promise(r => setTimeout(r, frames * (1000 / 60) + 150));
    }
  };

  const command: BattleCommand = {
    type: "battle",
    action: { kind: "fight", move: firstMoveWithPP.name }
  };

  const result = await executeBattle(command, controller, fullState);
  console.log(`\nResult: ${JSON.stringify(result)}`);

  await new Promise(r => setTimeout(r, 2000));

  const afterState = await stateReader.readState();
  console.log(`\nAfter battle action: inBattle=${afterState.wIsInBattle}`);
  if (afterState.wIsInBattle !== 0) {
    const afterCoords = await stateReader.readOverworldState();
    const afterFacing = await stateReader.readPlayerFacingState();
    const afterBadges = await stateReader.readBadgeState();
    const afterMenu = await stateReader.readMenuTextState();
    const afterFull = await readFullGameState({
      client,
      coordinates: afterCoords,
      playerFacing: afterFacing,
      badges: afterBadges,
      menuText: afterMenu,
    });
    if (afterFull.battle.enemy) {
      console.log(`Enemy HP now: ${afterFull.battle.enemy.hp}/${afterFull.battle.enemy.maxHp}`);
    }
  } else {
    console.log("Battle ended!");
  }
}

main().catch(console.error);
