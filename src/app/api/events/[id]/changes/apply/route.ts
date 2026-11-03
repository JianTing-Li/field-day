import { Api } from "@/contracts";
import { applyChanges } from "@/server/lifecycle/service";
import { handleAgentRun } from "../../../../_lib/http";

/** Agent runs can take minutes; the run budget stops at 240 s (D-JT19-3). */
export const maxDuration = 300;

export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/changes/apply">) {
  const { id } = await ctx.params;
  return handleAgentRun(request, Api.applyChanges.request, (body) => applyChanges(id, body));
}
