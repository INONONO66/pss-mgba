import type { ReactNode } from "react";

interface TimelineStep { title: string; tone?: "seeing" | "thinking" | "deciding"; children: ReactNode; }

export default function Timeline({ steps }: { steps: TimelineStep[] }) {
  return <div className="timeline">{steps.map((step, index) => <section className={`timeline-step ${step.tone ?? ""}`} data-step={index + 1} key={step.title}><div className={`step-title ${step.tone ?? ""}`}>{index + 1}. {step.title}</div>{step.children}</section>)}</div>;
}
