import { ZERO_USAGE, type RunAgent } from "@/contracts";

/**
 * Shared agent runner (owner: JT, task JT-01).
 * Will: send prompt + input to Claude, run the tool loop against deps.tools,
 * validate the final JSON with definition.output_schema, reject outputs whose
 * event_version / evidence_snapshot_id do not match the input, and record usage
 * against deps.budget.
 *
 * STUB: returns not_implemented. Agents' stub.ts files do not call it.
 */
export const runAgent: RunAgent = async (definition) => ({
  ok: false,
  error: { kind: "not_implemented", message: `runAgent not implemented yet (JT-01): ${definition.name}` },
  usage: ZERO_USAGE,
});
