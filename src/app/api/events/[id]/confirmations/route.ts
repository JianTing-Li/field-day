import { Api } from "@/contracts";
import { addConfirmation } from "@/server/lifecycle/service";
import { handle } from "../../../_lib/http";

export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/confirmations">) {
  const { id } = await ctx.params;
  return handle(request, Api.addConfirmation.request, (body) => addConfirmation(id, body));
}
