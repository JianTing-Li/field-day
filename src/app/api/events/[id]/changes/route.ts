import { Api } from "@/contracts";
import { reportChange } from "@/server/lifecycle/service";
import { handle } from "../../../_lib/http";

export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/changes">) {
  const { id } = await ctx.params;
  return handle(request, Api.reportChange.request, (body) => reportChange(id, body));
}
