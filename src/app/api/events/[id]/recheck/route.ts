import { Api } from "@/contracts";
import { recheck } from "@/server/lifecycle/service";
import { handle } from "../../../_lib/http";

export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/recheck">) {
  const { id } = await ctx.params;
  return handle(request, Api.recheck.request, (body) => recheck(id, body));
}
