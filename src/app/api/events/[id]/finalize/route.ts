import { Api } from "@/contracts";
import { finalize } from "@/server/lifecycle/service";
import { handle } from "../../../_lib/http";

export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/finalize">) {
  const { id } = await ctx.params;
  return handle(request, Api.finalize.request, (body) => finalize(id, body));
}
