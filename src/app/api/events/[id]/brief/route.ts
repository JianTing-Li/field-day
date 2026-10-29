import { Api } from "@/contracts";
import { updateBrief } from "@/server/lifecycle/service";
import { handle } from "../../../_lib/http";

/** Agent runs and first-request seeding can take minutes; the run budget stops at 240 s (D-JT19-3). */
export const maxDuration = 300;

export async function PUT(request: Request, ctx: RouteContext<"/api/events/[id]/brief">) {
  const { id } = await ctx.params;
  return handle(request, Api.updateBrief.request, (body) => updateBrief(id, body));
}
