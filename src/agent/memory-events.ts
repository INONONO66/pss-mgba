import type { SessionEvent } from "../session/types.js";
import type { AgentMemoryStore } from "./AgentMemoryStore.js";

export interface SessionMemoryWrite {
  readonly content: string;
  readonly section: "landmarks" | "lessons";
}

export function deriveSessionMemoryWrites(
  events: readonly SessionEvent[]
): readonly SessionMemoryWrite[] {
  return events.flatMap((event) => {
    if (event.transition?.kind === "map") {
      return [mapTransitionLandmark(event)];
    }

    if (isWallCollisionEvent(event)) {
      return [wallCollisionLesson(event)];
    }

    return [];
  });
}

export async function writeSessionMemoryEvents(
  store: Pick<AgentMemoryStore, "write">,
  events: readonly SessionEvent[]
): Promise<readonly SessionMemoryWrite[]> {
  const writes = deriveSessionMemoryWrites(events);
  for (const write of writes) {
    await store.write(write.section, write.content);
  }
  return writes;
}

function mapTransitionLandmark(event: SessionEvent): SessionMemoryWrite {
  const transition = event.transition;
  return {
    section: "landmarks",
    content: `Map transition observed: map ${transition?.fromMapId ?? "?"} -> ${transition?.toMapId ?? "?"}.`,
  };
}

function wallCollisionLesson(event: SessionEvent): SessionMemoryWrite {
  const state = event.miniState;
  const location =
    state === undefined
      ? "unknown location"
      : `map ${state.mapId} (${state.y},${state.x})`;
  return {
    section: "lessons",
    content: `Wall collision at ${location}; choose a different direction or route around the obstacle.`,
  };
}

function isWallCollisionEvent(event: SessionEvent): boolean {
  const metadataReason = event.metadata?.reason;
  const button = event.metadata?.button;
  return (
    metadataReason === "wall-collision" ||
    (event.kind === "input" &&
      event.mode === "overworld" &&
      event.transition?.kind === "none" &&
      typeof button === "string" &&
      isDirectionalButton(button)) ||
    event.message.toLowerCase().includes("wall collision")
  );
}

function isDirectionalButton(button: string): boolean {
  return (
    button === "Up" ||
    button === "Down" ||
    button === "Left" ||
    button === "Right"
  );
}
