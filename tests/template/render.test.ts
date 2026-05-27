import { describe, expect, it } from "vitest";
import { createMiniState } from "../../src/session/mini-state-reader.js";
import type { GameMode, SessionState } from "../../src/session/types.js";
import { resolveTools } from "../../src/template/fragments/tools.js";
import { renderSessionObservation } from "../../src/template/render.js";

function sessionState(mode: GameMode): SessionState {
  const miniState = createMiniState({
    battle: mode === "battle" ? 1 : 0,
    textBoxId: mode === "dialog" || mode === "naming" ? 1 : 0,
    letterDelay: 0,
    mapId: 2,
    y: 7,
    x: 4,
    partyCount: 1,
    walkCounter: 0,
    joyIgnore: 0,
    namingScreenType: mode === "naming" ? 1 : 0,
    windowY: mode === "dialog" || mode === "naming" ? 112 : 144,
    screenText: mode === "dialog" ? "HELLO" : "",
  });
  return {
    events: [
      {
        kind: "transition",
        message: "Moved to next tile",
        mode,
        phase: "input",
        transition: { kind: "movement", before: miniState, after: miniState },
      },
    ],
    miniState: { ...miniState, mode },
    mode,
    phase: "synced",
  };
}

describe("session observation template", () => {
  it("renders deterministically from SessionState", () => {
    const state = sessionState("overworld");
    const input = {
      sessionState: state,
      step: 3,
      objective: "Reach the next town",
      lastResult: { status: "success", reason: "moved" } as const,
      supervisorHint: "Avoid repeated wall bumps",
      memory: [{ name: "landmarks", entries: ["Pallet exit is north"] }],
      history: [{ command: "navigate(4,6)", result: "success" }],
    };

    expect(renderSessionObservation(input)).toBe(
      renderSessionObservation(input)
    );
    expect(renderSessionObservation(input)).toContain(
      "[SESSION]\nMode: overworld"
    );
    expect(renderSessionObservation(input)).toContain(
      "MiniState: map=2 y=7 x=4 readiness=ready"
    );
  });

  it("resolves mode-specific tools from SessionState", () => {
    expect(resolveTools(sessionState("overworld"))).toEqual([
      "pokemon_memory_delete",
      "pokemon_memory_read",
      "pokemon_memory_replace",
      "pokemon_memory_write",
      "pokemon_wait",
      "pokemon_navigate",
      "pokemon_interact",
      "pokemon_save",
      "pokemon_load",
      "pokemon_load_rollback",
    ]);
    expect(resolveTools(sessionState("battle"))).toEqual([
      "pokemon_memory_delete",
      "pokemon_memory_read",
      "pokemon_memory_replace",
      "pokemon_memory_write",
      "pokemon_wait",
      "pokemon_battle",
    ]);
    expect(resolveTools(sessionState("dialog"))).toEqual([
      "pokemon_memory_delete",
      "pokemon_memory_read",
      "pokemon_memory_replace",
      "pokemon_memory_write",
      "pokemon_dialog",
    ]);
    expect(resolveTools(sessionState("naming"))).toEqual([
      "pokemon_memory_delete",
      "pokemon_memory_read",
      "pokemon_memory_replace",
      "pokemon_memory_write",
      "pokemon_dialog",
    ]);
  });

  it("renders events, supervisor, memory, history, and resolved tools", () => {
    const rendered = renderSessionObservation({
      sessionState: sessionState("dialog"),
      supervisorHint: "Choose the visible option.",
      memory: [
        { name: "lessons", entries: ["Dialog choices require pokemon_dialog"] },
      ],
      history: [{ command: "dialog.choose(0)", result: "rejected" }],
    });

    expect(rendered).toContain(
      "[TOOLS]\n- pokemon_dialog\n- pokemon_memory_delete\n- pokemon_memory_read\n- pokemon_memory_replace\n- pokemon_memory_write"
    );
    expect(rendered).toContain(
      "[EVENTS]\n- transition/input/dialog: Moved to next tile transition=movement"
    );
    expect(rendered).toContain("[SUPERVISOR]\nChoose the visible option.");
    expect(rendered).toContain(
      "[MEMORY]\nlessons:\n- Dialog choices require pokemon_dialog"
    );
    expect(rendered).toContain("[HISTORY]\n- dialog.choose(0) => rejected");
  });
});
