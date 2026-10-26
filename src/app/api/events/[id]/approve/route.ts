import { Api } from "@/contracts";
import { approve } from "@/server/lifecycle/service";
import { handle } from "../../../_lib/http";

export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/approve">) {
  const { id } = await ctx.params;
  return handle(request, Api.approve.request, (body) => approve(id, body));
}
