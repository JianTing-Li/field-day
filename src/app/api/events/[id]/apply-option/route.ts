import { Api } from "@/contracts";
import { applyOption } from "@/server/lifecycle/service";
import { handle } from "../../../_lib/http";

export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/apply-option">) {
  const { id } = await ctx.params;
  return handle(request, Api.applyOption.request, (body) => applyOption(id, body));
}
