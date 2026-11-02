import { Api } from "@/contracts";
import { generateDraft } from "@/server/lifecycle/service";
import { handleAgentRun } from "../../../_lib/http";

/** Agent runs and first-request seeding can take minutes; the run budget stops at 240 s (D-JT19-3). */
export const maxDuration = 300;

export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/generate">) {
  const { id } = await ctx.params;
  return handleAgentRun(request, Api.generateDraft.request, (body) => generateDraft(id, body));
}
