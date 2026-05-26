import { useSupervisor } from "../api/hooks";

const ASSESSMENT_LABELS: Record<string, string> = {
  progressing: "진행 중",
  stuck: "정체",
  blocked: "차단",
  complete: "완료",
};

const GOAL_STATUS_LABELS: Record<string, string> = {
  active: "활성",
  pending: "대기",
  complete: "완료",
};

export default function SupervisorPanel() {
  const data = useSupervisor();

  if (!data) {
    return <div className="empty">Supervisor 상태 로딩 중...</div>;
  }

  const plan = data.plan;
  const assessment = data.assessment ?? plan?.assessment ?? null;
  const activeGoal = data.activeGoal ?? plan?.activeGoal ?? null;
  const guidance = plan?.guidance ?? [];
  const avoid = plan?.avoid ?? [];
  const citations = plan?.citations ?? [];

  return (
    <div className="state-body scroll">
      <div className="kv" style={{ marginBottom: 10 }}>
        <b>Supervisor 상태</b>
        <span>KB {data.knowledgeBaseSize}개 · RUN {data.runId}</span>
      </div>

      <section className="kv" style={{ marginBottom: 10 }}>
        <b>평가</b>
        <span>{assessment ? ASSESSMENT_LABELS[assessment.state] ?? assessment.state : "알 수 없음"}</span>
      </section>

      {activeGoal ? (
        <section className="kv" style={{ marginBottom: 10 }}>
          <b>현재 목표</b>
          <span>{activeGoal.title}</span>
          <span>상태: {GOAL_STATUS_LABELS[activeGoal.status] ?? activeGoal.status}</span>
          <span>왜: {activeGoal.why}</span>
          <span>우선순위: {activeGoal.priority}</span>
        </section>
      ) : (
        <div className="empty compact">활성 목표가 없습니다.</div>
      )}

      {plan ? (
        <>
          {guidance.length > 0 ? (
            <section style={{ marginBottom: 10 }}>
              <div className="label" style={{ marginBottom: 6 }}>가이드</div>
              <div className="kv">
                {guidance.map((item, index) => <span key={`${index}-${item}`}>{item}</span>)}
              </div>
            </section>
          ) : null}

          {avoid.length > 0 ? (
            <section style={{ marginBottom: 10 }}>
              <div className="label" style={{ marginBottom: 6 }}>주의</div>
              <div className="kv">
                {avoid.map((item, index) => <span key={`${index}-${item}`}>{item}</span>)}
              </div>
            </section>
          ) : null}

          {citations.length > 0 ? (
            <section style={{ marginBottom: 10 }}>
              <div className="label" style={{ marginBottom: 6 }}>근거</div>
              <div className="kv">
                {citations.map((item, index) => <span key={`${index}-${item}`}>{item}</span>)}
              </div>
            </section>
          ) : null}

          {plan.goals.length > 0 ? (
            <section>
              <div className="label" style={{ marginBottom: 6 }}>목표 목록</div>
              {plan.goals.map((goal) => (
                <div key={goal.id} className="kv" style={{ marginBottom: 6 }}>
                  <b>{goal.title}</b>
                  <span>{GOAL_STATUS_LABELS[goal.status] ?? goal.status} · {goal.kind}</span>
                  <span>{goal.why}</span>
                  <span>{goal.successCriteria.join(" · ")}</span>
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : (
        <div className="empty compact">Supervisor 플랜이 아직 없습니다.</div>
      )}
    </div>
  );
}
