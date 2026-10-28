import type { AgentErrorKind, CheckId, CheckStatus, GateCheck } from "@/contracts";

/**
 * Expected outcome for one PRD eval case (PRD §2c, §3d). Written before the case's first run;
 * never tuned after seeing results. The eval runner (JT-17) grades every architecture
 * (rules only, 1 agent, 4 agents) against these fields, not against the fixture's full agent outputs.
 */
export interface ExpectedOutcome {
  case_number: number;
  title: string;
  /** One of the 5 known-feasible conflicts used by the conflict-resolution metric (cases 4–8). */
  known_feasible: boolean;
  /** Whether a conflict should trigger Logistics + Workout Adaptation + Reviewer. */
  specialists_run: boolean;
  /**
   * Status of the final result: the Reviewer's when specialists run, otherwise Planning's.
   * Null when no agent output may be accepted at all (the harness rejects it).
   */
  final_status: "draft" | "needs_verification" | "no_feasible_option" | null;
  /** check_plan overall for the final plan or the top-ranked option; null when nothing is accepted. */
  overall: CheckStatus | null;
  /** Check statuses the final plan or top-ranked option must have. Checks not listed are not graded. */
  checks: Partial<Record<CheckId, CheckStatus>>;
  /** Whether a finalize request for the organizer-approved version may succeed. */
  finalize: "allowed" | "blocked";
  /** Save-gate checks that must fail on finalize (empty when finalize is allowed or never reached). */
  gate_failures: GateCheck["id"][];
  /** Missing-data reasons that must be visible (matched against snapshot coverage gaps). */
  required_gaps: string[];
  /** Revision rounds allowed; the PRD caps every run at 1. */
  max_revision_rounds: 0 | 1;
  /** Agent error the harness must report, if any. */
  agent_error: AgentErrorKind | null;
  /** Behaviors the grader checks by hand or in harness tests. */
  notes: string[];
}
