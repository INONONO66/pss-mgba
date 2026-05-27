import type { MgbaButton } from "../mgba/MgbaTypes.js";

type PressAction = {
  type: "press";
  button: MgbaButton;
  frames: number;
};

type HoldAction = {
  type: "hold";
  button: MgbaButton;
  frames: number;
};

type WaitAction = {
  type: "wait";
  frames: number;
};

type SequenceAction = {
  type: "sequence";
  actions: HarnessAction[];
};

export type HarnessAction = PressAction | HoldAction | WaitAction | SequenceAction;

export type PolicyDecision = {
  action: HarnessAction;
  rationale: string;
  confidence: number;
  observedStateCitations: string[];
};
