import type { CommandResult, RawInput } from "../control/CommandTypes.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";
import type { InputGate } from "../session/input-gate.js";
import type { InputResult } from "../session/types.js";

const VALID_BUTTONS = new Set<MgbaButton>([
  "A",
  "B",
  "Up",
  "Down",
  "Left",
  "Right",
  "Start",
  "Select",
]);
const MAX_INTERVENTION_INPUTS = 20;
const MIN_FRAMES = 1;
const MAX_FRAMES = 60;
const DIALOG_BUTTONS = new Set<MgbaButton>(["A", "B", "Start"]);

export interface SupervisorInterventionInput {
  readonly inputGate: Pick<InputGate, "press">;
  readonly inputs: readonly RawInput[];
  readonly reason: string;
}

export interface SupervisorInterventionResult {
  readonly commandInputs: readonly RawInput[];
  readonly inputResults: readonly InputResult[];
  readonly result: CommandResult;
}

export async function runSupervisorIntervention(
  input: SupervisorInterventionInput
): Promise<SupervisorInterventionResult> {
  const validation = validateInputs(input.inputs);
  if (validation !== undefined) {
    return {
      commandInputs: [],
      inputResults: [],
      result: validation,
    };
  }

  const requestedInputs = input.inputs.slice(0, MAX_INTERVENTION_INPUTS);
  const commandInputs: RawInput[] = [];
  const inputResults: InputResult[] = [];
  for (const intervention of requestedInputs) {
    commandInputs.push(intervention);
    const result = await input.inputGate.press(
      intervention.button,
      intervention.frames,
      {
        allowDialog: DIALOG_BUTTONS.has(intervention.button),
        reason: `recovery:${input.reason}`,
        source: "supervisor",
      }
    );
    inputResults.push(result);
    if (!result.executed) {
      return {
        commandInputs,
        inputResults,
        result: {
          status: "rejected",
          reason: result.reason ?? "input_rejected",
          details: `Recovery input stopped at ${result.intent.button}: ${result.reason ?? "unknown"}`,
        },
      };
    }
  }

  return {
    commandInputs,
    inputResults,
    result: {
      status: "success",
      reason: "recovery_input",
      details: `Recovery input sent ${commandInputs.length} input(s).`,
    },
  };
}

function validateInputs(
  inputs: readonly RawInput[]
): CommandResult | undefined {
  if (inputs.length === 0) {
    return {
      status: "rejected",
      reason: "invalid_intervention",
      details: "Recovery input must contain at least one input.",
    };
  }

  if (inputs.length > MAX_INTERVENTION_INPUTS) {
    return {
      status: "rejected",
      reason: "invalid_intervention",
      details: `Recovery input has ${inputs.length} inputs; maximum is ${MAX_INTERVENTION_INPUTS}.`,
    };
  }

  for (const input of inputs) {
    if (!VALID_BUTTONS.has(input.button)) {
      return {
        status: "rejected",
        reason: "invalid_intervention",
        details: `Invalid recovery input button: ${String(input.button)}`,
      };
    }
    if (
      !Number.isInteger(input.frames) ||
      input.frames < MIN_FRAMES ||
      input.frames > MAX_FRAMES
    ) {
      return {
        status: "rejected",
        reason: "invalid_intervention",
        details: `Invalid recovery input frame count for ${input.button}: ${input.frames}`,
      };
    }
  }
}
