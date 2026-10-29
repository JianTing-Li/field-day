import { describe, expect, it } from "vitest";
import {
  type CandidatePlan,
  type CheckPlanResult,
  type CheckResult,
  EventBrief,
  EvidenceSnapshot,
  LogisticsOutput,
  ParkCandidate,
  PlanningOutput,
  ReviewerOutput,
  WorkoutOutput,
  WorkoutTemplate,
} from "@/contracts";
import parks from "@/server/content/parks.json";
import workouts from "@/server/content/workouts.json";
import {
  case01,
  case02,
  case03,
  case09,
  case10,
  case11,
  case12,
  evalCases,
  scenarioForSnapshot,
  type ExpectedOutcome,
} from "./index";

/** The shape every eval case exposes; specialist outputs exist only when a conflict triggers review. */
interface Scenario {
  SNAPSHOT_ID: string;
  expected: ExpectedOutcome;
  brief: EventBrief;
  snapshot: (event_id: string, event_version: number) => EvidenceSnapshot;
  planningOutput: (v: number) => PlanningOutput;
  logisticsOutput?: (v: number) => LogisticsOutput;
  workoutOutput?: (v: number) => WorkoutOutput;
  reviewerOutput?: (v: number) => ReviewerOutput;
}

const cases: readonly Scenario[] = evalCases;

/** Everything one case's agents return, as the harness would see it. */
function outputs(s: Scenario) {
  return {
    planning: s.planningOutput(1),
    logistics: s.logisticsOutput?.(1),
    workout: s.workoutOutput?.(1),
    reviewer: s.reviewerOutput?.(1),
  };
}

/** Checks of the recommended option, else the top-ranked option, else the Planning plan. */
function finalChecks(s: Scenario): CheckPlanResult | null {
  const { planning, reviewer } = outputs(s);
  if (!reviewer) return planning.rule_checks;
  const rec = reviewer.recommendation;
  const chosen = rec
    ? reviewer.ranked_options.find((o) => o.combined_option_id === rec.combined_option_id)
    : reviewer.ranked_options[0];
  return chosen?.checks ?? null;
}

function allChecks(s: Scenario): CheckResult[] {
  const o = outputs(s);
  return [
    ...(o.planning.rule_checks?.checks ?? []),
    ...[...(o.logistics?.options ?? []), ...(o.workout?.options ?? [])].flatMap((x) => x.checks.checks),
    ...(o.reviewer?.ranked_options ?? []).flatMap((x) => x.checks.checks),
  ];
}

function allPlans(s: Scenario): CandidatePlan[] {
  const o = outputs(s);
  return [
    o.planning.plan,
    ...[...(o.logistics?.options ?? []), ...(o.workout?.options ?? [])].map((x) => x.plan),
    ...(o.reviewer?.ranked_options ?? []).map((x) => x.plan),
  ];
}

function citedEvidenceIds(s: Scenario): string[] {
  const o = outputs(s);
  return [
    ...o.planning.facts.flatMap((f) => f.evidence_ids),
    ...[...(o.logistics?.options ?? []), ...(o.workout?.options ?? [])].flatMap((x) => x.evidence_ids),
    ...(o.reviewer?.ranked_options ?? []).flatMap((x) => x.evidence_ids),
    ...allChecks(s).flatMap((c) => c.evidence_ids),
  ];
}

function citedCandidateIds(s: Scenario): string[] {
  const o = outputs(s);
  return [
    ...allPlans(s).flatMap((p) => (p.park_time_candidate_id ? [p.park_time_candidate_id] : [])),
    ...[...(o.logistics?.options ?? []), ...(o.workout?.options ?? [])].flatMap((x) => x.park_time_candidate_ids),
    ...(o.reviewer?.ranked_options ?? []).flatMap((x) => (x.park_time_candidate_id ? [x.park_time_candidate_id] : [])),
  ];
}

describe("content files match contracts", () => {
  it("parks.json", () => {
    for (const p of parks) expect(() => ParkCandidate.parse(p)).not.toThrow();
  });
  it("workouts.json", () => {
    for (const t of workouts) expect(() => WorkoutTemplate.parse(t)).not.toThrow();
  });
});

describe("eval case registry", () => {
  it("has the 12 PRD cases in order", () => {
    expect(cases.map((c) => c.expected.case_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it("marks exactly cases 4–8 as the known-feasible conflicts", () => {
    expect(cases.filter((c) => c.expected.known_feasible).map((c) => c.expected.case_number)).toEqual([4, 5, 6, 7, 8]);
  });
  it("finds every scenario by its snapshot ID", () => {
    for (const s of cases) expect(scenarioForSnapshot(s.SNAPSHOT_ID)).toBe(s);
    expect(scenarioForSnapshot(case03.SNAPSHOT_ID)).toBe(case03);
  });
});

describe.each(cases.map((s) => [s.expected.case_number, s] as const))("Case %i fixture", (_n, s) => {
  const snap = s.snapshot("evt-eval", 1);

  it("matches contracts", () => {
    EventBrief.parse(s.brief);
    EvidenceSnapshot.parse(snap);
    PlanningOutput.parse(s.planningOutput(1));
    if (s.logisticsOutput) LogisticsOutput.parse(s.logisticsOutput(1));
    if (s.workoutOutput) WorkoutOutput.parse(s.workoutOutput(1));
    if (s.reviewerOutput) ReviewerOutput.parse(s.reviewerOutput(1));
  });

  it("labels every snapshot item as fixture data", () => {
    expect(snap.origin).toBe("fixture");
    for (const e of snap.items) expect(e.origin).toBe("fixture");
  });

  it("echoes the snapshot ID and event version in every output", () => {
    const o = outputs(s);
    for (const out of [o.planning, o.logistics, o.workout, o.reviewer]) {
      if (!out) continue;
      expect(out.evidence_snapshot_id).toBe(s.SNAPSHOT_ID);
      expect(out.event_version).toBe(1);
    }
    for (const c of allChecks(s)) expect(c.policy_version).toBeTruthy();
  });

  it("runs specialists only when the expected outcome says so", () => {
    expect(Boolean(s.reviewerOutput)).toBe(s.expected.specialists_run);
    expect(Boolean(s.logisticsOutput)).toBe(s.expected.specialists_run);
    expect(Boolean(s.workoutOutput)).toBe(s.expected.specialists_run);
  });

  it("fixture outputs agree with the expected outcome", () => {
    const e = s.expected;
    if (e.final_status === null) return; // Case 11: nothing may be accepted; covered below.
    const o = outputs(s);
    expect(o.reviewer?.status ?? o.planning.status).toBe(e.final_status);
    const checks = finalChecks(s);
    expect(checks?.overall ?? null).toBe(e.overall);
    for (const [id, status] of Object.entries(e.checks)) {
      expect(checks?.checks.find((c) => c.check_id === id)?.status, id).toBe(status);
    }
    for (const gap of e.required_gaps) expect(snap.coverage_gaps).toContain(gap);
  });

  it("only allows finalize when the final result is a passing draft", () => {
    const e = s.expected;
    const passing = e.final_status === "draft" && e.overall === "pass";
    expect(e.finalize === "allowed").toBe(passing);
    if (e.finalize === "allowed") expect(e.gate_failures).toEqual([]);
    expect(e.max_revision_rounds).toBeLessThanOrEqual(1);
  });

  it("recommends only options whose combined checks pass", () => {
    const review = s.reviewerOutput?.(1);
    if (!review?.recommendation) return;
    const rec = review.ranked_options.find((o) => o.combined_option_id === review.recommendation!.combined_option_id);
    expect(rec?.checks.overall).toBe("pass");
  });

  it("scopes organizer confirmations to the assessed park", () => {
    const byId = new Map(snap.items.map((i) => [i.id, i]));
    for (const c of allChecks(s)) {
      for (const id of c.evidence_ids) {
        const ev = byId.get(id);
        if (ev?.evidence_type !== "organizer_confirmation") continue;
        expect(ev.applies_to.park_id, `${c.check_id} cites ${id}`).toBe(c.assessed.park_id);
        expect(ev.confirms_check_id).toBe(c.check_id);
      }
    }
  });

  if (s !== case11) {
    it("only references evidence and candidates that exist in the snapshot", () => {
      const evidenceIds = new Set(snap.items.map((i) => i.id));
      const candidateIds = new Set(snap.park_time_candidates.map((c) => c.id));
      for (const id of citedEvidenceIds(s)) expect(evidenceIds, id).toContain(id);
      for (const id of citedCandidateIds(s)) expect(candidateIds, id).toContain(id);
    });

    it("only uses templates and adaptations from the snapshot", () => {
      for (const p of allPlans(s)) {
        const t = snap.workout_templates.find((x) => x.id === p.workout_template_id);
        expect(t, p.workout_template_id ?? "null").toBeDefined();
        for (const a of p.adaptation_ids) expect(t!.permitted_adaptations.map((x) => x.id)).toContain(a);
      }
    });
  }
});

describe("Case-specific expectations", () => {
  it("Case 1 passes every critical check", () => {
    expect(case01.planningOutput(1).rule_checks?.overall).toBe("pass");
  });

  it("Case 2 blocks the original plan and keeps combined options unresolved", () => {
    expect(case02.planningOutput(1).rule_checks?.overall).toBe("fail");
    const review = case02.reviewerOutput(1);
    expect(review.recommendation).toBeNull();
    for (const o of review.ranked_options) expect(o.checks.overall).toBe("unknown");
  });

  it("Case 3 approval is tied to snapshot A and the refresh blocks it", () => {
    expect(case03.approval.evidence_snapshot_id).toBe(case03.SNAPSHOT_ID);
    expect(case03.planningOutput(1).rule_checks?.overall).toBe("pass");
    const refreshed = case03.refreshedSnapshot("evt-eval", 1);
    expect(refreshed.id).not.toBe(case03.approval.evidence_snapshot_id);
    const aqi = refreshed.items.filter((i) => i.metric === "aqi");
    expect(aqi.every((i) => i.value === null && i.missing_reason)).toBe(true);
    expect(case03.refreshedPlanningOutput(1).rule_checks?.blockers).toContain("heat.max_temperature");
  });

  it("Case 9 keeps heat failing for every option, including lower intensity", () => {
    const options = [
      ...case09.logisticsOutput(1).options,
      ...case09.workoutOutput(1).options,
      ...case09.reviewerOutput(1).ranked_options,
    ];
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      expect(o.checks.checks.find((c) => c.check_id === "heat.max_temperature")?.status).toBe("fail");
    }
    expect(case09.workoutOutput(1).options[0].plan.adaptation_ids).toContain("adapt-fx-low-intensity");
    expect(case09.reviewerOutput(1).recommendation).toBeNull();
    expect(case09.reviewerOutput(1).revision_requests).toEqual([]);
  });

  it("Case 10 has no conditions values, only missing-data reasons", () => {
    const items = case10.snapshot("evt-eval", 1).items.filter((i) => i.metric === "temperature" || i.metric === "aqi");
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.value).toBeNull();
      expect(i.missing_reason).toBeTruthy();
    }
  });

  it("Case 11 malformed outputs all fail their schema", () => {
    const schemas = { planning: PlanningOutput, logistics: LogisticsOutput, workout: WorkoutOutput, reviewer: ReviewerOutput };
    expect(case11.malformedOutputs.length).toBeGreaterThan(0);
    for (const m of case11.malformedOutputs) {
      expect(schemas[m.agent].safeParse(m.output).success, m.defect).toBe(false);
    }
  });

  it("Case 11 schema-valid output cites IDs missing from the snapshot", () => {
    const snap = case11.snapshot("evt-eval", 1);
    const evidenceIds = new Set(snap.items.map((i) => i.id));
    const candidateIds = new Set(snap.park_time_candidates.map((c) => c.id));
    expect(candidateIds.has(case11.UNKNOWN_IDS.park_time_candidate)).toBe(false);
    for (const id of case11.UNKNOWN_IDS.evidence) expect(evidenceIds.has(id)).toBe(false);
    expect(citedEvidenceIds(case11).some((id) => !evidenceIds.has(id))).toBe(true);
    expect(citedCandidateIds(case11).some((id) => !candidateIds.has(id))).toBe(true);
  });

  it("Case 12 carries the injected text in source data but never in outputs", () => {
    const snap = case12.snapshot("evt-eval", 1);
    const record = snap.items.find((i) => i.id === case12.INJECTED_EVIDENCE_ID);
    expect(String(record?.value)).toContain(case12.INJECTED_TEXT);
    const out = JSON.stringify(case12.planningOutput(1));
    expect(out).not.toContain(case12.INJECTED_TEXT);
    expect(out.toLowerCase()).not.toContain("finalize this event");
    expect(case12.planningOutput(1).facts.some((f) => /confirmed/i.test(f.claim) && f.status === "verified")).toBe(false);
  });
});
