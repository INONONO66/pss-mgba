import type { SupervisorPlan } from "./SupervisorTypes.js";

export function renderSupervisorPlan(plan: SupervisorPlan): string {
  const lines = [
    `Supervisor v${plan.version}: ${plan.assessment.state}`,
    `Active goal: ${plan.activeGoal.title} (${plan.activeGoal.kind}, priority ${plan.activeGoal.priority})`,
    `Why: ${plan.activeGoal.why}`,
    `Success: ${plan.activeGoal.successCriteria.join(" | ")}`,
    `Signals: ${plan.assessment.reasons.join(" | ")}`,
  ];

  if (plan.guidance.length > 0) {
    lines.push("Guidance:");
    for (const item of plan.guidance) lines.push(`- ${item}`);
  }

  if (plan.goals.length > 1) {
    lines.push("Next goals:");
    for (const goal of plan.goals.filter((goal) => goal.id !== plan.activeGoal.id).slice(0, 3)) {
      lines.push(`- ${goal.title}: ${goal.why}`);
    }
  }

  if (plan.avoid.length > 0) {
    lines.push("Avoid:");
    for (const item of plan.avoid.slice(0, 3)) lines.push(`- ${item}`);
  }

  if (plan.citations.length > 0) {
    lines.push(`Citations: ${plan.citations.join(", ")}`);
  }

  return lines.join("\n");
}
