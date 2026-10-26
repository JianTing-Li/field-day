import { Api } from "@/contracts";
import { updateBrief } from "@/server/lifecycle/service";
import { handle } from "../../../_lib/http";

export async function PUT(request: Request, ctx: RouteContext<"/api/events/[id]/brief">) {
  const { id } = await ctx.params;
  return handle(request, Api.updateBrief.request, (body) => updateBrief(id, body));
}
