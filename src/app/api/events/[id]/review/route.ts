import { Api } from "@/contracts";
import { requestReview } from "@/server/lifecycle/service";
import { handle } from "../../../_lib/http";

export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/review">) {
  const { id } = await ctx.params;
  return handle(request, Api.requestReview.request, (body) => requestReview(id, body));
}
